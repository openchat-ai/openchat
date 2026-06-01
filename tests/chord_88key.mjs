// chord_88key.mjs — 88-dim direct matching + 调性先验
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;
const WINDOW = 0.5, NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = 88;

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
const TYPES = Object.keys(CHORD_INTS); const N_TYPES = 12;
const ALL_CHORDS = []; for (let r = 0; r < 12; r++) for (let ti = 0; ti < 12; ti++) ALL_CHORDS.push(NOTE[r] + TYPES[ti]);
const N_STATES = ALL_CHORDS.length;
function rootOf(name) { return name.replace(/maj|m|dim|aug|sus\d|7|b5/g,''); }

// === 88-dim chord templates ===
function build88Templates() {
  const tmpl = new Array(N_STATES);
  for (let r = 0; r < 12; r++) for (let ti = 0; ti < 12; ti++) {
    const v = new Float64Array(NOTE_COUNT); let sum = 0;
    const ints = CHORD_INTS[TYPES[ti]];
    // Include ALL octaves of each interval
    for (let ni = 0; ni < NOTE_COUNT; ni++) {
      const midi = NOTE_MIN + ni;
      const pc = (midi - NOTE_MIN) % 12;
      for (const d of ints) if (pc === (r + d) % 12) { v[ni] = 1; sum += 1; break; }
    }
    const n = Math.sqrt(sum) || 1; for (let i = 0; i < NOTE_COUNT; i++) v[i] /= n;
    tmpl[r * 12 + ti] = v;
  }
  return tmpl;
}
const TMPL88 = build88Templates();

// === 12-dim chroma templates (baseline) ===
function build12Templates() {
  const tmpl = new Array(N_STATES);
  for (let r = 0; r < 12; r++) for (let ti = 0; ti < 12; ti++) {
    const v = new Float64Array(12); let sum = 0;
    for (const d of CHORD_INTS[TYPES[ti]]) v[(r + d) % 12] = 1;
    for (let i = 0; i < 12; i++) sum += v[i] * v[i];
    const n = Math.sqrt(sum) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
    tmpl[r * 12 + ti] = v;
  }
  return tmpl;
}
const TMPL12 = build12Templates();

// === Krumhansl-Schmuckler key profiles ===
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function detectKey(chroma) {
  let bestKey = 0, bestCorr = -1;
  for (let k = 0; k < 24; k++) {
    const profile = k < 12 ? KS_MAJOR : KS_MINOR;
    const offset = k % 12;
    let muP = 0, muC = 0;
    for (let i = 0; i < 12; i++) { muP += profile[i]; muC += chroma[(i + offset) % 12]; }
    muP /= 12; muC /= 12;
    let num = 0, dP = 0, dC = 0;
    for (let i = 0; i < 12; i++) {
      const pi = profile[i] - muP;
      const ci = chroma[(i + offset) % 12] - muC;
      num += pi * ci; dP += pi * pi; dC += ci * ci;
    }
    const corr = num / (Math.sqrt(dP) * Math.sqrt(dC) + 1e-10);
    if (corr > bestCorr) { bestCorr = corr; bestKey = k; }
  }
  const keyName = NOTE[bestKey % 12] + (bestKey < 12 ? ' major' : ' minor');
  return { key: bestKey, name: keyName, confidence: bestCorr };
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
function solveFISTA(H, g, maxIter) {
  const n = g.length; let x = new Float64Array(n), y = new Float64Array(n), tk = 1;
  let L = 1; const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = Math.random() * 2 - 1;
  for (let p = 0; p < 10; p++) { const w = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * v[j]; w[i] = s; } let nw=0,nv=0; for(let i=0;i<n;i++){nw+=w[i]*w[i];nv+=v[i]*v[i];} L=Math.sqrt(nw/nv); for(let i=0;i<n;i++) v[i]=w[i]/Math.sqrt(nw); }
  L = 2 * L; const invL = 1 / L;
  for (let iter = 0; iter < maxIter; iter++) {
    const Hy = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * y[j]; Hy[i] = s; }
    let change = 0; const xNew = new Float64Array(n);
    for (let i = 0; i < n; i++) { const grad = 2 * (Hy[i] - g[i]); const raw = y[i] - invL * grad; xNew[i] = Math.max(0, raw); change += Math.abs(xNew[i] - x[i]); }
    if (change < 1e-8 * n) break;
    const tk1 = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2; const beta = (tk - 1) / tk1;
    for (let i = 0; i < n; i++) y[i] = xNew[i] + beta * (xNew[i] - x[i]); x = xNew; tk = tk1;
  }
  return x;
}
function nnlsGetActs(dict, H, accum, maxIter) {
  const g = new Float64Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * accum[b]; g[i] = s; }
  return solveFISTA(H, g, maxIter);
}
function actsToChroma(acts) {
  const chroma = new Float64Array(12);
  for (let ni = 0; ni < NOTE_COUNT; ni++) chroma[((NOTE_MIN + ni) % 12 + 12) % 12] += acts[ni];
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return chroma;
}
function match12(chroma, templates) {
  let best = '', bs = -1;
  for (let si = 0; si < N_STATES; si++) { let d = 0; const t = templates[si]; for (let i = 0; i < 12; i++) d += chroma[i] * t[i]; if (d > bs) { bs = d; best = ALL_CHORDS[si]; } }
  return best;
}
function match12WithPrior(chroma, templates, key) {
  // key: 0-11 major, 12-23 minor
  const keyIsMinor = key >= 12;
  const keyRoot = key % 12;
  // Major key chords: I=I ii=ii iii=iii IV=IV V=V vi=vi vii=vii(dim)
  // Minor key chords: i=i ii(dim)=ii(#) III=III iv=iv v=v VI=VI VII=VII
  const majorChords = [0,0, 2,2, 4,4, 5,5, 7,7, 9,9, 11,11]; // diatonic roots in major
  const minorChords = [0,0, 2,2, 3,3, 5,5, 7,7, 8,8, 10,10]; // diatonic roots in natural minor
  const diatonics = keyIsMinor ? minorChords : majorChords;
  const diatonicset = new Set(diatonics.map(d => (keyRoot + d) % 12));
  let best = '', bs = -1;
  for (let si = 0; si < N_STATES; si++) {
    const r = Math.floor(si / 12);
    let d = 0; const t = templates[si]; for (let i = 0; i < 12; i++) d += chroma[i] * t[i];
    if (diatonicset.has(r)) d += 0.2; // diatomic bonus
    if (d > bs) { bs = d; best = ALL_CHORDS[si]; }
  }
  return best;
}

function match88(acts, templates) {
  // Normalize NNLS activations
  let s = 0; for (let i = 0; i < NOTE_COUNT; i++) s += acts[i] * acts[i];
  const n = Math.sqrt(s) || 1;
  if (n < 1e-10) return 'N';
  const v = new Float64Array(NOTE_COUNT); for (let i = 0; i < NOTE_COUNT; i++) v[i] = acts[i] / n;

  let best = '', bs = -1;
  for (let si = 0; si < N_STATES; si++) {
    let d = 0; const t = templates[si];
    for (let i = 0; i < NOTE_COUNT; i++) d += v[i] * t[i];
    if (d > bs) { bs = d; best = ALL_CHORDS[si]; }
  }
  return best;
}
function match88WithPrior(acts, templates, key) {
  let s = 0; for (let i = 0; i < NOTE_COUNT; i++) s += acts[i] * acts[i];
  const n = Math.sqrt(s) || 1; if (n < 1e-10) return 'N';
  const v = new Float64Array(NOTE_COUNT); for (let i = 0; i < NOTE_COUNT; i++) v[i] = acts[i] / n;

  const keyIsMinor = key >= 12;
  const keyRoot = key % 12;
  const majorChords = [0,2,4,5,7,9,11];
  const minorChords = [0,2,3,5,7,8,10];
  const diatonics = new Set((keyIsMinor ? minorChords : majorChords).map(d => (keyRoot + d) % 12));

  let best = '', bs = -1;
  for (let si = 0; si < N_STATES; si++) {
    const r = Math.floor(si / 12);
    let d = 0; const t = templates[si];
    for (let i = 0; i < NOTE_COUNT; i++) d += v[i] * t[i];
    if (diatonics.has(r)) d += 0.15;
    if (d > bs) { bs = d; best = ALL_CHORDS[si]; }
  }
  return best;
}

// === MIDI GT ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;

function getGT(start, dur) {
  const nWin = Math.ceil(dur / WINDOW);
  const gtAct = new Array(nWin); for (let i = 0; i < nWin; i++) gtAct[i] = new Set();
  for (let ti = 1; ti <= 3; ti++) { // guitar only
    const track = midi.tracks[ti]; let tick = 0, ac = {};
    for (const e of track) {
      tick += e.deltaTime || 0; const sec = tick / ppq * spb;
      if (sec > start + dur) break;
      if (e.type === 'noteOn' && e.velocity > 0) ac[e.noteNumber] = sec;
      if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
        if (ac[e.noteNumber]) {
          const si = Math.max(0, Math.floor((ac[e.noteNumber] - start) / WINDOW));
          const ei = Math.min(nWin, Math.ceil((sec - start) / WINDOW));
          for (let w = si; w < ei; w++) gtAct[w].add(e.noteNumber);
          delete ac[e.noteNumber];
        }
      }
    }
  }
  const gtC = new Array(nWin);
  function midiChroma(notes) { const c = new Float64Array(12); for (const n of notes) c[((n % 12) + 12) % 12] += 1; let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n; return c; }
  for (let w = 0; w < nWin; w++) gtC[w] = gtAct[w].size > 0 ? match12(midiChroma([...gtAct[w]]), TMPL12) : 'N';
  return { gtAct, gtC };
}

// === WAV processing ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff, sr;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'fmt ') sr = buf.readUInt32LE(off + 12); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const totalFrames = Math.floor((buf.length - dataOff) / 4);

console.log('Building NNLS...');
const dict = buildDict(1.0, 10);
const H = precomputeH(dict);

function process(start, dur) {
  const ss = Math.round(start * SR), ds = Math.round(dur * SR);
  const mono = new Float64Array(ds);
  for (let i = 0; i < ds && ss + i < totalFrames; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
  const tf = Math.floor((ds - FFT_SIZE) / HOP) + 1;
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
  const winFrames = Math.round(WINDOW * SR / HOP);
  const nWin = Math.ceil(dur / WINDOW);

  const chromas = new Array(nWin);
  const acts = new Array(nWin);
  for (let w = 0; w < nWin; w++) {
    const accum = new Float64Array(HALF); let fc = 0;
    for (let o = 0; o < winFrames && w * winFrames + o < tf; o++) { const m = specHarm[w * winFrames + o]; for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++; }
    if (!fc) { chromas[w] = null; acts[w] = null; continue; }
    for (let i = 0; i < HALF; i++) accum[i] /= fc;
    acts[w] = nnlsGetActs(dict, H, accum, 150);
    chromas[w] = actsToChroma(acts[w]);
  }

  // Key detection from average chroma
  let avgC = new Float64Array(12); let cnt = 0;
  for (const c of chromas) if (c) { for (let i = 0; i < 12; i++) avgC[i] += c[i]; cnt++; }
  if (cnt) for (let i = 0; i < 12; i++) avgC[i] /= cnt;
  const key = detectKey(avgC);
  console.log(`  检测调性: ${key.name} (ρ=${key.confidence.toFixed(3)})`);

  return { nWin, chromas, acts, key };
}

function evaluate(detC, gtC) {
  let c = 0, r = 0, t = 0;
  for (let w = 0; w < detC.length; w++) {
    if (gtC[w] === 'N') continue;
    t++; if (detC[w] === gtC[w]) c++; if (rootOf(detC[w]) === rootOf(gtC[w])) r++;
  }
  return { acc: c / t * 100 || 0, rootAcc: r / t * 100 || 0, correct: c, rootMatch: r, total: t };
}

for (const { label, start, dur } of [
  { label: 'T5 (200-210s)', start: 200, dur: 10 },
  { label: '全曲 (0-432s)', start: 0, dur: 432 },
]) {
  console.log(`\n=== ${label} ===`);
  const { gtAct, gtC } = getGT(start, dur);
  const { nWin, chromas, acts, key } = process(start, dur);

  const results = [];

  // 12-dim chroma baseline
  const d12 = new Array(nWin).fill('N');
  for (let w = 0; w < nWin; w++) { if (gtC[w] === 'N' || !chromas[w]) continue; d12[w] = match12(chromas[w], TMPL12); }
  results.push(['12-dim chroma', evaluate(d12, gtC), d12]);

  // 12-dim + key prior
  const d12k = new Array(nWin).fill('N');
  for (let w = 0; w < nWin; w++) { if (gtC[w] === 'N' || !chromas[w]) continue; d12k[w] = match12WithPrior(chromas[w], TMPL12, key.key); }
  results.push(['12-dim + 调性先验', evaluate(d12k, gtC), d12k]);

  // 88-dim direct
  const d88 = new Array(nWin).fill('N');
  for (let w = 0; w < nWin; w++) { if (gtC[w] === 'N' || !acts[w]) continue; d88[w] = match88(acts[w], TMPL88); }
  results.push(['88-dim direct', evaluate(d88, gtC), d88]);

  // 88-dim + key prior
  const d88k = new Array(nWin).fill('N');
  for (let w = 0; w < nWin; w++) { if (gtC[w] === 'N' || !acts[w]) continue; d88k[w] = match88WithPrior(acts[w], TMPL88, key.key); }
  results.push(['88-dim + 调性先验', evaluate(d88k, gtC), d88k]);

  for (const [name, res, det] of results) {
    console.log(`  ${name}: ${res.acc.toFixed(1)}% (${res.correct}/${res.total}), 根音=${res.rootAcc.toFixed(1)}%`);
    if (nWin <= 20) console.log(`    ${gtC.filter(c=>c!=='N').join(' → ')}\n    ${det.filter(d=>d!=='N').join(' → ')}`);
  }
}
