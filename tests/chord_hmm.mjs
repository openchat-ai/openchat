// chord_hmm.mjs — HMM/Viterbi + temporal smoothing
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;
const NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = NOTE_MAX - NOTE_MIN + 1;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}

const eqWeight = new Float64Array(HALF);
const eqPts = [[20,-50],[31.5,-39],[63,-26],[100,-19],[200,-11],[500,-3],[1000,0],[2000,1.5],[3150,0.5],[5000,-2],[6300,-4],[8000,-6],[10000,-10],[12500,-15]];
for (let i = 0; i < HALF; i++) {
  const f = i * SR / FFT_SIZE; let g = -100;
  for (let pi = 0; pi < eqPts.length - 1; pi++) if (f >= eqPts[pi][0] && f <= eqPts[pi+1][0]) { const t = (f - eqPts[pi][0]) / (eqPts[pi+1][0] - eqPts[pi][0]); g = eqPts[pi][1] + t * (eqPts[pi+1][1] - eqPts[pi][1]); }
  eqWeight[i] = Math.pow(10, g / 20);
}

function hpss(spec) {
  const frames = spec.length, bins = spec[0].length;
  const harm = spec.map(r => new Float64Array(r));
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
const TYPES = Object.keys(CHORD_INTS); const N_TYPES = TYPES.length, N_ROOTS = 12;
const ALL_CHORDS = [];
for (let r = 0; r < N_ROOTS; r++) for (let ti = 0; ti < N_TYPES; ti++) ALL_CHORDS.push(NOTE[r] + TYPES[ti]);
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
const rootOf = name => name.replace(/maj|m|dim|aug|sus\d|7|b5/g,'');
const stateRoot = si => Math.floor(si / N_TYPES);
const stateName = si => ALL_CHORDS[si];

// === NNLS Chroma ===
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

// === HMM ===
function buildTransition(alphaSelf, alpha5th) {
  const T = new Array(N_STATES);
  for (let i = 0; i < N_STATES; i++) {
    T[i] = new Float64Array(N_STATES);
    const ri = stateRoot(i);
    let rowSum = 0;
    for (let j = 0; j < N_STATES; j++) {
      const rj = stateRoot(j);
      let score;
      if (i === j) score = alphaSelf;
      else {
        const interval = (rj - ri + 12) % 12;
        if (interval === 7) score = alpha5th;
        else score = 1;
      }
      T[i][j] = score; rowSum += score;
    }
    for (let j = 0; j < N_STATES; j++) T[i][j] /= rowSum;
  }
  return T;
}

function viterbi(emissions, trans, prior) {
  const Tlen = emissions.length;
  const delta = new Array(Tlen); const psi = new Array(Tlen);
  delta[0] = new Float64Array(N_STATES); psi[0] = new Int32Array(N_STATES);
  for (let s = 0; s < N_STATES; s++) { delta[0][s] = Math.log(prior[s] + 1e-300) + Math.log(emissions[0][s] + 1e-300); psi[0][s] = -1; }
  for (let t = 1; t < Tlen; t++) {
    delta[t] = new Float64Array(N_STATES); psi[t] = new Int32Array(N_STATES);
    for (let s = 0; s < N_STATES; s++) {
      let bestVal = -Infinity, bestIdx = 0;
      for (let sp = 0; sp < N_STATES; sp++) { const val = delta[t-1][sp] + Math.log(trans[sp][s] + 1e-300); if (val > bestVal) { bestVal = val; bestIdx = sp; } }
      delta[t][s] = bestVal + Math.log(emissions[t][s] + 1e-300);
      psi[t][s] = bestIdx;
    }
  }
  let bestLast = 0; for (let s = 1; s < N_STATES; s++) if (delta[Tlen-1][s] > delta[Tlen-1][bestLast]) bestLast = s;
  const path = new Int32Array(Tlen); path[Tlen-1] = bestLast;
  for (let t = Tlen - 2; t >= 0; t--) path[t] = psi[t+1][path[t+1]];
  return path;
}

// === MIDI GT ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;
const gtWindows = Math.ceil(T5_DUR / WINDOW);
const gtActive = new Array(gtWindows);
for (let i = 0; i < gtWindows; i++) gtActive[i] = new Set();
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, ac = {};
  for (const e of track) { tick += e.deltaTime || 0; const sec = tick / ppq * spb; if (sec > T5_START + T5_DUR) break; if (e.type === 'noteOn' && e.velocity > 0) ac[e.noteNumber] = sec; if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) { if (ac[e.noteNumber]) { const si = Math.max(0, Math.floor((ac[e.noteNumber] - T5_START) / WINDOW)); const ei = Math.min(gtWindows, Math.ceil((sec - T5_START) / WINDOW)); for (let w = si; w < ei; w++) gtActive[w].add(e.noteNumber); delete ac[e.noteNumber]; } } }
}
function midiChroma(notes) { const c = new Float64Array(12); for (const n of notes) c[((n % 12) + 12) % 12] += 1; let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n; return c; }
function dot(c, t) { let d = 0; for (let i = 0; i < 12; i++) d += c[i] * t[i]; return d; }
function matchChord(chroma) {
  let best = '', bs = -1;
  for (let si = 0; si < N_STATES; si++) { const d = dot(chroma, TEMPLATES[si]); if (d > bs) { bs = d; best = ALL_CHORDS[si]; } }
  return best;
}
const gtChords = new Array(gtWindows);
for (let w = 0; w < gtWindows; w++) gtChords[w] = gtActive[w].size > 0 ? matchChord(midiChroma([...gtActive[w]])) : 'N';
console.log('GT chords:', gtChords.filter(c=>c!=='N').join(' → '));

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

// === HPSS + NNLS Chroma ===
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

console.log('Building NNLS...');
const dict = buildDict(1.0, 10);
const H = precomputeH(dict);

// Compute per-window chroma
const rawChroma = [];
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') { rawChroma.push(null); continue; }
  const accum = new Float64Array(HALF); let fc = 0;
  for (let o = 0; o < winFrames && w * winFrames + o < tf; o++) { const m = specHarm[w * winFrames + o]; for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++; }
  if (fc) for (let i = 0; i < HALF; i++) accum[i] /= fc;
  rawChroma.push(nnlsChroma(dict, H, accum, 0, 200, 1.5));
}

// === Experiments ===
function evaluate(detSeq) {
  let c=0, r=0, t=0;
  for (let w = 0; w < gtWindows; w++) { if (gtChords[w]==='N') continue; t++; if (detSeq[w]===gtChords[w]) c++; if (rootOf(detSeq[w])===rootOf(gtChords[w])) r++; }
  return { acc: c/t*100, rootAcc: r/t*100, correct: c, rootMatch: r, total: t };
}

// No-HMM baselines
const baseResults = [];
for (const sharp of [1, 1.5, 2]) {
  const det = new Array(gtWindows).fill('N');
  for (let w = 0; w < gtWindows; w++) {
    if (gtChords[w] === 'N') continue;
    const c = new Float64Array(12); for (let i = 0; i < 12; i++) c[i] = Math.pow(rawChroma[w][i], sharp);
    let s = 0; for (let i = 0; i < 12; i++) s += c[i]*c[i]; s = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= s;
    det[w] = matchChord(c);
  }
  const res = evaluate(det);
  baseResults.push({ label: `sharpen^${sharp}`, res, seq: det.filter(d=>d!=='N').join(' → ') });
}

// Temporal smoothing (moving average)
for (const halfWin of [1, 2]) {
  const det = new Array(gtWindows).fill('N');
  for (let w = 0; w < gtWindows; w++) {
    if (gtChords[w] === 'N') continue;
    const accum = new Float64Array(12); let cnt = 0;
    for (let o = -halfWin; o <= halfWin; o++) { const wi = w + o; if (wi >= 0 && wi < gtWindows && rawChroma[wi]) { for (let i = 0; i < 12; i++) accum[i] += rawChroma[wi][i]; cnt++; } }
    if (cnt) for (let i = 0; i < 12; i++) accum[i] /= cnt;
    let s = 0; for (let i = 0; i < 12; i++) s += accum[i]*accum[i]; s = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) accum[i] /= s;
    det[w] = matchChord(accum);
  }
  const res = evaluate(det);
  baseResults.push({ label: `smooth±${halfWin}`, res, seq: det.filter(d=>d!=='N').join(' → ') });
}

// HMM with weak constraints
const hmmResults = [];
for (const alphaSelf of [1.5, 2, 3]) {
  for (const alpha5th of [1.2, 1.5, 2]) {
    const trans = buildTransition(alphaSelf, alpha5th);
    const emissions = [];
    for (let w = 0; w < gtWindows; w++) {
      emissions[w] = new Float64Array(N_STATES);
      for (let s = 0; s < N_STATES; s++) emissions[w][s] = Math.max(dot(rawChroma[w] || new Float64Array(12), TEMPLATES[s]), 1e-10);
    }
    const prior = new Float64Array(N_STATES); for (let s = 0; s < N_STATES; s++) prior[s] = 1 / N_STATES;
    const path = viterbi(emissions, trans, prior);
    const det = new Array(gtWindows).fill('N');
    for (let w = 0; w < gtWindows; w++) if (gtChords[w] !== 'N') det[w] = stateName(path[w]);
    hmmResults.push({ label: `HMM αself=${alphaSelf} α5=${alpha5th}`, res: evaluate(det), seq: det.filter(d=>d!=='N').join(' → ') });
  }
}

// === REPORT ===
console.log('\n=== 基线 ===');
for (const r of baseResults) console.log(`${r.label}: ${r.res.acc.toFixed(1)}%, 根音=${r.res.rootAcc.toFixed(1)}% (${r.res.correct}/${r.res.total})\n  ${r.seq}`);

console.log('\n=== Chroma 平滑 ===');
for (const r of baseResults) if (r.label.startsWith('smooth')) console.log(`${r.label}: ${r.res.acc.toFixed(1)}%, 根音=${r.res.rootAcc.toFixed(1)}%\n  ${r.seq}`);

console.log('\n=== HMM ===');
for (const r of hmmResults) console.log(`${r.label}: ${r.res.acc.toFixed(1)}%, 根音=${r.res.rootAcc.toFixed(1)}%\n  ${r.seq}`);
