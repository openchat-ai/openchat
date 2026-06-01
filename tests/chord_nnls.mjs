// chord_nnls.mjs — NNLS: chroma sharpening + template tuning
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;
const NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = NOTE_MAX - NOTE_MIN + 1;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
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
    const vals = [];
    for (let o = -halfT; o <= halfT; o++) { const fi = f + o; if (fi >= 0 && fi < frames) vals.push(spec[fi][b]); }
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
function makeTmpl(patterns) {
  const out = {};
  for (const [suffix, ints] of patterns) for (let r = 0; r < 12; r++) {
    const v = new Float64Array(12); let sum = 0;
    for (const d of ints) v[(r + d) % 12] = 1;
    for (let i = 0; i < 12; i++) sum += v[i] * v[i];
    const n = Math.sqrt(sum) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
    out[NOTE[r] + suffix] = v;
  }
  return out;
}
const allTemplates = makeTmpl(Object.entries(CHORD_INTS));
function matchChord(chroma, t) { let b='', bs=-1; for (const [n, v] of Object.entries(t)) { let d=0; for(let i=0;i<12;i++) d+=chroma[i]*v[i]; if(d>bs){bs=d;b=n;} } return b; }
function rootOf(n) { return n.replace(/maj|m|dim|aug|sus\d|7|b5/g,''); }

function subtractNote(mag, freq, sr) {
  const r = new Float64Array(mag);
  for (let h = 1; h <= 10; h++) { const hf = freq * h; if (hf > sr / 2) break; const hb = Math.round(hf * FFT_SIZE / sr); for (let d = -3; d <= 3; d++) { const b = hb + d; if (b >= 0 && b < HALF) r[b] = 0; } }
  return r;
}
function pitchesISS(mag, sr) {
  const minB = Math.round(HALF * 40 / sr), maxB = Math.round(HALF * 1500 / sr);
  const ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
  const pitches = []; let cur = new Float64Array(mag);
  for (let iter = 0; iter < 10; iter++) {
    const hs = new Float64Array(HALF);
    for (let i = minB; i < maxB; i++) { let s = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += cur[idx] * ww[h]; } hs[i] = s; }
    let bestI = minB, bestV = 0;
    for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i-1] && hs[i] > hs[i+1] && hs[i] > bestV) { bestV = hs[i]; bestI = i; } }
    if (bestV < 1e-6) break;
    const freq = bestI * sr / FFT_SIZE;
    if (freq < 40 || freq > 1500) break;
    const conf = bestV / (mag.reduce((s,v)=>s+v,0) / HALF + 1e-10);
    if (conf < 0.5) break;
    const midi = f2m(freq);
    const isH = pitches.some(p => p.conf >= conf && (freq / p.freq >= 1.9 && freq / p.freq <= 2.1 || freq / p.freq >= 2.9 && freq / p.freq <= 3.1));
    const dup = pitches.some(p => Math.abs(f2m(p.freq) - midi) < 3);
    if (!dup && !isH) pitches.push({ freq, midi, pc: ((Math.round(midi) % 12) + 12) % 12, conf });
    cur = subtractNote(cur, freq, sr);
  }
  return pitches;
}

// === NNLS ===
function buildDict(harmDecay, harmCap) {
  const dict = new Array(HALF);
  for (let b = 0; b < HALF; b++) dict[b] = new Float64Array(NOTE_COUNT);
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
  for (let i = 0; i < NOTE_COUNT; i++) {
    H[i] = new Float64Array(NOTE_COUNT);
    for (let j = 0; j < NOTE_COUNT; j++) {
      let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * dict[b][j];
      H[i][j] = s;
    }
  }
  return H;
}

function solveFISTA(H, g, l1, maxIter) {
  const n = g.length;
  let x = new Float64Array(n);
  let y = new Float64Array(n);
  let tk = 1;
  let L = 1;
  let v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.random() * 2 - 1;
  for (let power = 0; power < 10; power++) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * v[j]; w[i] = s; }
    let nw = 0, nv = 0;
    for (let i = 0; i < n; i++) { nw += w[i] * w[i]; nv += v[i] * v[i]; }
    L = Math.sqrt(nw / nv);
    for (let i = 0; i < n; i++) v[i] = w[i] / Math.sqrt(nw);
  }
  L = 2 * L;
  const invL = 1 / L;
  for (let iter = 0; iter < maxIter; iter++) {
    const Hy = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * y[j]; Hy[i] = s; }
    let change = 0;
    const xNew = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const grad = 2 * (Hy[i] - g[i]);
      const raw = y[i] - invL * grad;
      xNew[i] = l1 > 0 ? Math.max(0, Math.abs(raw) - l1 * invL) : Math.max(0, raw);
      change += Math.abs(xNew[i] - x[i]);
    }
    if (change < 1e-8 * n) break;
    const tk1 = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    const beta = (tk - 1) / tk1;
    for (let i = 0; i < n; i++) y[i] = xNew[i] + beta * (xNew[i] - x[i]);
    x = xNew;
    tk = tk1;
  }
  return x;
}

function nnlsChroma(dict, H, accum, l1, maxIter, sharpen) {
  const g = new Float64Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) {
    let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * accum[b];
    g[i] = s;
  }
  const acts = solveFISTA(H, g, l1, maxIter);
  const chroma = new Float64Array(12);
  for (let ni = 0; ni < NOTE_COUNT; ni++) {
    const pc = ((NOTE_MIN + ni) % 12 + 12) % 12;
    chroma[pc] += acts[ni];
  }
  // Apply sharpening
  if (sharpen !== 1) for (let i = 0; i < 12; i++) chroma[i] = Math.pow(chroma[i], sharpen);
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return chroma;
}

function issChroma(accum, sr, sharpen) {
  const gPitches = pitchesISS(accum, sr);
  const chroma = new Float64Array(12);
  for (const p of gPitches) chroma[p.pc] += p.conf;
  if (sharpen !== 1) for (let i = 0; i < 12; i++) chroma[i] = Math.pow(chroma[i], sharpen);
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return chroma;
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
const gtChords = new Array(gtWindows);
for (let w = 0; w < gtWindows; w++) gtChords[w] = gtActive[w].size > 0 ? matchChord(midiChroma([...gtActive[w]]), allTemplates) : 'N';

console.log('GT chords:', gtChords.filter(c=>c!=='N').join(' → '));
console.log('');

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

// === HPSS Spectrum ===
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

// === Experiments ===
const configs = [];
// ISS baseline at different sharpen levels
for (const s of [1, 2, 3]) configs.push([`ISS sharpen^${s}`, 0, 0, 0, 0, true, 'iss', s]);
// NNLS with sharpen
for (const dec of [0.8, 1.0]) for (const s of [1, 1.5, 2]) configs.push([`NNLS h^-${dec} sharpen^${s}`, dec, 20, 0, 200, true, 'nnls', s]);

console.log('NNLS Chroma — sharpen 实验');
console.log('GT non-N:', gtChords.filter(c=>c!=='N').length);

for (const [label, decay, cap, l1, iters, useHPSS, method, sharpen] of configs) {
  const spec = useHPSS ? specHarm : rawSpec;
  let dict, H;
  if (method === 'nnls') {
    dict = buildDict(decay, cap);
    H = precomputeH(dict);
  }

  const detChords = [];
  let correct = 0, rootMatch = 0, total = 0, chromaSim = 0;
  const t0 = Date.now();

  for (let w = 0; w < gtWindows; w++) {
    if (gtChords[w] === 'N') { detChords.push('N'); continue; }
    total++;

    const accum = new Float64Array(HALF);
    let fc = 0;
    for (let o = 0; o < winFrames && w * winFrames + o < tf; o++) {
      const m = spec[w * winFrames + o];
      for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++;
    }
    if (fc) for (let i = 0; i < HALF; i++) accum[i] /= fc;

    let chroma;
    if (method === 'iss') {
      chroma = issChroma(accum, SR, sharpen);
    } else {
      chroma = nnlsChroma(dict, H, accum, l1, iters, sharpen);
    }

    const gtC = midiChroma([...gtActive[w]]);
    let sim = 0; for (let i = 0; i < 12; i++) sim += chroma[i] * gtC[i];
    chromaSim += sim;

    const det = matchChord(chroma, allTemplates);
    detChords.push(det);
    if (det === gtChords[w]) correct++;
    if (rootOf(det) === rootOf(gtChords[w])) rootMatch++;
  }

  const dt = Date.now() - t0;
  console.log(`\n${label}: ${(correct/total*100).toFixed(1)}% (${correct}/${total}), 根音=${(rootMatch/total*100).toFixed(1)}%, sim=${(chromaSim/total).toFixed(3)}, ${dt}ms`);
  console.log(`  ${detChords.filter(d=>d!=='N').join(' → ')}`);
}
