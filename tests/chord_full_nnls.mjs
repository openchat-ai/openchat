// chord_full_nnls.mjs — 全曲 NNLS 和弦 + 贝斯约束
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;
const WINDOW = 0.5, NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = NOTE_MAX - NOTE_MIN + 1;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
const eqWeight = new Float64Array(HALF);
const eqPts = [[20,-50],[31.5,-39],[63,-26],[100,-19],[200,-11],[500,-3],[1000,0],[2000,1.5],[3150,0.5],[5000,-2],[6300,-4],[8000,-6],[10000,-10],[12500,-15]];
for (let i = 0; i < HALF; i++) {
  const f = i * SR / FFT_SIZE; let g = -100;
  for (let pi = 0; pi < eqPts.length - 1; pi++) if (f >= eqPts[pi][0] && f <= eqPts[pi+1][0]) { const t = (f - eqPts[pi][0]) / (eqPts[pi+1][0] - eqPts[pi][0]); g = eqPts[pi][1] + t * (eqPts[pi+1][1] - eqPts[pi][1]); }
  eqWeight[i] = Math.pow(10, g / 20);
}

function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}

function hpss(spec) {
  const frames = spec.length, bins = spec[0].length, harm = spec.map(r => new Float64Array(r));
  const tWin = 7, halfT = Math.floor(tWin / 2);
  for (let b = 0; b < bins; b++) for (let f = 0; f < frames; f++) {
    const vals = []; for (let o = -halfT; o <= halfT; o++) { const fi = f + o; if (fi >= 0 && fi < frames) vals.push(spec[fi][b]); }
    vals.sort((a, b) => a - b); harm[f][b] = vals[Math.floor(vals.length / 2)];
  }
  return harm;
}

const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHORD_INTS = {
  '': [0,4,7], 'm': [0,3,7], 'dim': [0,3,6], 'aug': [0,4,8],
  'sus2': [0,2,7], 'sus4': [0,5,7],
  '7': [0,4,7,10], 'm7': [0,3,7,10], 'maj7': [0,4,7,11], 'dim7': [0,3,6,9], 'm7b5': [0,3,6,10], 'aug7': [0,4,8,10],
};
const TYPES = Object.keys(CHORD_INTS); const N_TYPES = 12, N_ROOTS = 12;
const ALL_CHORDS = []; for (let r = 0; r < N_ROOTS; r++) for (let ti = 0; ti < N_TYPES; ti++) ALL_CHORDS.push(NOTE[r] + TYPES[ti]);
const N_STATES = ALL_CHORDS.length;
function makeTemplates() {
  const tmpl = new Array(N_STATES);
  for (let r = 0; r < N_ROOTS; r++) for (let ti = 0; ti < N_TYPES; ti++) {
    const v = new Float64Array(12); let sum = 0;
    for (const d of CHORD_INTS[TYPES[ti]]) v[(r + d) % 12] = 1;
    for (let i = 0; i < 12; i++) sum += v[i] * v[i];
    const n = Math.sqrt(sum) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
    tmpl[r * N_TYPES + ti] = v;
  }
  return tmpl;
}
const TEMPLATES = makeTemplates();
function rootOf(name) { return name.replace(/maj|m|dim|aug|sus\d|7|b5/g,''); }
function matchChord(chroma) {
  let best = '', bs = -1;
  for (let si = 0; si < N_STATES; si++) { let d = 0; const t = TEMPLATES[si]; for (let i = 0; i < 12; i++) d += chroma[i] * t[i]; if (d > bs) { bs = d; best = ALL_CHORDS[si]; } }
  return best;
}
function matchChordWithRoot(chroma, rootPC) {
  let best = '', bs = -1;
  for (let r = 0; r < N_ROOTS; r++) if (r !== rootPC) continue; // only chords with given root
  for (let ti = 0; ti < N_TYPES; ti++) {
    const si = rootPC * N_TYPES + ti;
    let d = 0; const t = TEMPLATES[si]; for (let i = 0; i < 12; i++) d += chroma[i] * t[i];
    if (d > bs) { bs = d; best = ALL_CHORDS[si]; }
  }
  return best || matchChord(chroma); // fallback
}

// === NNLS ===
function buildDict(harmDecay, harmCap) {
  const dict = new Array(HALF); for (let b = 0; b < HALF; b++) dict[b] = new Float64Array(NOTE_COUNT);
  for (let ni = 0; ni < NOTE_COUNT; ni++) {
    const freq = 440 * Math.pow(2, (NOTE_MIN + ni - 69) / 12);
    for (let h = 1; h <= harmCap; h++) {
      const hf = freq * h; if (hf > SR / 2) break;
      const bin = Math.round(hf * FFT_SIZE / SR);
      if (bin >= 0 && bin < HALF) dict[bin][ni] += Math.pow(h, -harmDecay);
    }
  }
  for (let ni = 0; ni < NOTE_COUNT; ni++) {
    let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][ni] * dict[b][ni];
    const n = Math.sqrt(s) || 1; for (let b = 0; b < HALF; b++) dict[b][ni] /= n;
  }
  return dict;
}
function precomputeH(dict) {
  const H = new Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) { H[i] = new Float64Array(NOTE_COUNT); for (let j = 0; j < NOTE_COUNT; j++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * dict[b][j]; H[i][j] = s; } }
  return H;
}
function solveFISTA(H, g, l1, maxIter) {
  const n = g.length; let x = new Float64Array(n), y = new Float64Array(n), tk = 1;
  let L = 1; const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = Math.random() * 2 - 1;
  for (let p = 0; p < 10; p++) { const w = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * v[j]; w[i] = s; } let nw=0,nv=0; for(let i=0;i<n;i++){nw+=w[i]*w[i];nv+=v[i]*v[i];} L=Math.sqrt(nw/nv);for(let i=0;i<n;i++)v[i]=w[i]/Math.sqrt(nw); }
  L = 2 * L; const invL = 1 / L;
  for (let iter = 0; iter < maxIter; iter++) {
    const Hy = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * y[j]; Hy[i] = s; }
    let change = 0; const xNew = new Float64Array(n);
    for (let i = 0; i < n; i++) { const grad = 2 * (Hy[i] - g[i]); const raw = y[i] - invL * grad; xNew[i] = l1 > 0 ? Math.max(0, Math.abs(raw) - l1 * invL) : Math.max(0, raw); change += Math.abs(xNew[i] - x[i]); }
    if (change < 1e-8 * n) break;
    const tk1 = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2; const beta = (tk - 1) / tk1;
    for (let i = 0; i < n; i++) y[i] = xNew[i] + beta * (xNew[i] - x[i]); x = xNew; tk = tk1;
  }
  return x;
}
function nnlsChroma(dict, H, accum, l1, maxIter, sharpen) {
  const g = new Float64Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * accum[b]; g[i] = s; }
  const acts = solveFISTA(H, g, l1, maxIter);
  const chroma = new Float64Array(12);
  for (let ni = 0; ni < NOTE_COUNT; ni++) chroma[((NOTE_MIN + ni) % 12 + 12) % 12] += acts[ni];
  if (sharpen !== 1) for (let i = 0; i < 12; i++) chroma[i] = Math.pow(chroma[i], sharpen);
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return chroma;
}

// === MIDI GT (full song) ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;

const MAX_TIME = 432;
const nWindows = Math.ceil(MAX_TIME / WINDOW);
const gtActive = new Array(nWindows);
for (let i = 0; i < nWindows; i++) gtActive[i] = new Set();
// Bass track is track 4 (index 3 in 0-based)
const bassActive = new Array(nWindows);
for (let i = 0; i < nWindows; i++) bassActive[i] = new Set();

for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, ac = {};
  for (const e of track) {
    tick += e.deltaTime || 0; const sec = tick / ppq * spb;
    if (sec > MAX_TIME) break;
    if (e.type === 'noteOn' && e.velocity > 0) ac[e.noteNumber] = sec;
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      if (ac[e.noteNumber]) {
        const si = Math.max(0, Math.floor(ac[e.noteNumber] / WINDOW));
        const ei = Math.min(nWindows, Math.ceil(sec / WINDOW));
        for (let w = si; w < ei; w++) {
          if (ti <= 3) gtActive[w].add(e.noteNumber); // 只用吉他轨作 GT
          if (ti === 4) bassActive[w].add(e.noteNumber);
        }
        delete ac[e.noteNumber];
      }
    }
  }
}

function midiChroma(notes) {
  const c = new Float64Array(12); for (const n of notes) c[((n % 12) + 12) % 12] += 1;
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n;
  return c;
}

// GT chords
const gtChords = new Array(nWindows);
for (let w = 0; w < nWindows; w++) gtChords[w] = gtActive[w].size > 0 ? matchChord(midiChroma([...gtActive[w]])) : 'N';
const nonN = gtChords.filter(c => c !== 'N').length;
console.log(`全曲: ${nWindows} windows, ${nonN} non-N`);

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff, sr;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'fmt ') sr = buf.readUInt32LE(off + 12); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const totalFrames = Math.floor((buf.length - dataOff) / 4);

function readChunk(ci) {
  const start = ci * 10 * sr, dur = Math.min(10 * sr, totalFrames - start);
  const mono = new Float64Array(dur);
  for (let i = 0; i < dur; i++) { const idx = (start + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
  return { mono, offset: start / sr, dur: dur / sr };
}

console.log('Building NNLS dict...');
const dict = buildDict(1.0, 10);
const H = precomputeH(dict);

const chunks = Math.ceil(totalFrames / sr / 10);
const allChroma = new Array(nWindows);
const winFrames = Math.round(WINDOW * SR / HOP);

const t0 = Date.now();

for (let ci = 0; ci < chunks; ci++) {
  const { mono, offset, dur } = readChunk(ci);
  const tf = Math.floor((mono.length - FFT_SIZE) / HOP) + 1;
  process.stdout.write(`\r  Chunk ${ci+1}/${chunks} ${offset.toFixed(0)}s`);

  // FFT + HPSS
  const rawSpec = [];
  for (let fi = 0; fi < tf; fi++) {
    const frame = mono.slice(fi * HOP, fi * HOP + FFT_SIZE);
    const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
    for (let i = 0; i < frame.length; i++) re[i] = frame[i] * win[i];
    fft(re, im, FFT_SIZE);
    const mag = new Float64Array(HALF);
    for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * eqWeight[i];
    rawSpec.push(mag);
  }
  const specHarm = hpss(rawSpec);

  // Per window chroma
  const wStart = Math.round(offset / WINDOW);
  const wEnd = Math.min(nWindows, Math.ceil((offset + dur) / WINDOW));
  for (let w = wStart; w < wEnd; w++) {
    if (gtChords[w] === 'N') continue;
    const accum = new Float64Array(HALF); let fc = 0;
    const fStart = (w * WINDOW - offset) * SR / HOP;
    const fEnd = fStart + winFrames;
    for (let fi = Math.max(0, Math.round(fStart)); fi < Math.min(tf, Math.round(fEnd)); fi++) {
      const m = specHarm[fi]; for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++;
    }
    if (fc) for (let i = 0; i < HALF; i++) accum[i] /= fc;
    allChroma[w] = nnlsChroma(dict, H, accum, 0, 150, 1.5);
  }
}

const elapsed = (Date.now() - t0) / 1000;
console.log(`\nNNLS chroma done: ${elapsed.toFixed(0)}s`);

// === Evaluation ===
function evaluate(detSeq) {
  let c = 0, r = 0, t = 0;
  for (let w = 0; w < nWindows; w++) {
    if (gtChords[w] === 'N') continue;
    t++; if (detSeq[w] === gtChords[w]) c++; if (rootOf(detSeq[w]) === rootOf(gtChords[w])) r++;
  }
  return { acc: c / t * 100, rootAcc: r / t * 100, correct: c, rootMatch: r, total: t };
}

// Mode 1: plain NNLS chord
console.log('\n=== NNLS 和弦（全曲） ===');
const detPlain = new Array(nWindows).fill('N');
for (let w = 0; w < nWindows; w++) {
  if (gtChords[w] === 'N' || !allChroma[w]) continue;
  detPlain[w] = matchChord(allChroma[w]);
}
const r1 = evaluate(detPlain);
console.log(`Chord: ${r1.acc.toFixed(1)}% (${r1.correct}/${r1.total}), 根音=${r1.rootAcc.toFixed(1)}%`);

// Mode 2: bass-constrained
console.log('\n=== NNLS + 贝斯根音约束 ===');
const detBass = new Array(nWindows).fill('N');
let bassUsed = 0;
for (let w = 0; w < nWindows; w++) {
  if (gtChords[w] === 'N' || !allChroma[w]) continue;
  if (bassActive[w].size > 0) {
    const bassNotes = [...bassActive[w]];
    const bassRoots = new Set(bassNotes.map(n => n % 12));
    // Pick the most common bass root
    const counts = new Array(12).fill(0);
    for (const n of bassNotes) counts[n % 12]++;
    let bRoot = 0, bMax = 0;
    for (let i = 0; i < 12; i++) { if (counts[i] > bMax) { bMax = counts[i]; bRoot = i; } }
    detBass[w] = matchChordWithRoot(allChroma[w], bRoot);
    bassUsed++;
  } else {
    detBass[w] = matchChord(allChroma[w]);
  }
}
const r2 = evaluate(detBass);
console.log(`Chord: ${r2.acc.toFixed(1)}% (${r2.correct}/${r2.total}), 根音=${r2.rootAcc.toFixed(1)}% (bass约束 ${bassUsed} windows)`);
