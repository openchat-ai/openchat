// experiment4_swipe.mjs — SWIPE 多音高检测 vs NNLS
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;
const NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = NOTE_MAX - NOTE_MIN + 1;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));

function f2m(f) { return 12 * Math.log2(f / 440) + 69; }

function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function computeMag(s) {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i];
  fft(re, im, FFT_SIZE);
  const m = new Float64Array(HALF); for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return m;
}

// === SWIPE iterative spectral subtraction ===
function buildSwipeKernel(harmCount) {
  return Array.from({ length: NOTE_COUNT }, (_, ni) => {
    const f0 = 440 * Math.pow(2, (NOTE_MIN + ni - 69) / 12);
    const kv = new Float64Array(HALF);
    let ee = 0;
    for (let h = 1; h <= harmCount; h++) {
      const hf = f0 * h; if (hf > SR / 2) break;
      const eb = hf * FFT_SIZE / SR; if (eb >= HALF - 1) break;
      const b = Math.round(eb);
      const w = 1 / h;
      kv[b] += w; ee += w * w;
    }
    const n = Math.sqrt(ee) || 1;
    for (let b = 0; b < HALF; b++) kv[b] /= n;
    return kv;
  });
}

// Precompute once
const swipeKernels = buildSwipeKernel(10);
const swipeKernels8 = buildSwipeKernel(8);
const swipeKernels12 = buildSwipeKernel(12);

function swipeIterDetect(s, sr, kernels, maxNotes, minScore) {
  const mag = computeMag(s);
  let residual = new Float64Array(mag);
  const found = [];

  for (let iter = 0; iter < maxNotes; iter++) {
    let best = -1, bestScore = 0;
    for (let ni = 0; ni < NOTE_COUNT; ni++) {
      let dot = 0;
      for (let b = 0; b < HALF; b++) dot += residual[b] * kernels[ni][b];
      if (dot > bestScore) { bestScore = dot; best = ni; }
    }
    if (best < 0 || bestScore < minScore) break;

    let scale = 0, kDot = 0;
    for (let b = 0; b < HALF; b++) { scale += residual[b] * kernels[best][b]; kDot += kernels[best][b] * kernels[best][b]; }
    const amp = kDot > 0 ? scale / kDot : 0;
    if (amp < 1e-4) break;

    for (let b = 0; b < HALF; b++) residual[b] = Math.max(0, residual[b] - amp * kernels[best][b]);
    found.push({ midi: NOTE_MIN + best, amp, conf: Math.min(1, bestScore / (found.length ? found[0].amp : bestScore) + 0.1) });
  }

  const maxA = found.length ? found[0].amp : 1;
  return found.map(n => ({ freq: Math.round(440 * Math.pow(2, (n.midi - 69) / 12) * 10) / 10, midi: n.midi, conf: Math.min(1, n.amp / maxA) }));
}

// === NNLS (from earlier) ===
function buildDict(harmDecay, harmCap) {
  const dict = new Array(HALF); for (let b = 0; b < HALF; b++) dict[b] = new Float64Array(NOTE_COUNT);
  for (let ni = 0; ni < NOTE_COUNT; ni++) {
    const freq = 440 * Math.pow(2, (NOTE_MIN + ni - 69) / 12);
    for (let h = 1; h <= harmCap; h++) { const hf = freq * h; if (hf > SR / 2) break; const bin = Math.round(hf * FFT_SIZE / SR); if (bin >= 0 && bin < HALF) dict[bin][ni] += Math.pow(h, -harmDecay); }
  }
  for (let ni = 0; ni < NOTE_COUNT; ni++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][ni] * dict[b][ni]; const n = Math.sqrt(s) || 1; for (let b = 0; b < HALF; b++) dict[b][ni] /= n; }
  return dict;
}
function precomputeH(dict) {
  const H = new Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) { H[i] = new Float64Array(NOTE_COUNT); for (let j = 0; j < NOTE_COUNT; j++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * dict[b][j]; H[i][j] = s; } }
  return H;
}
function solveNNLS(H, g, maxIter) {
  const n = g.length; let x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = 1e-4;
  const Hx = new Float64Array(n); const eps = 1e-12;
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * x[j]; Hx[i] = Math.max(s, eps); }
    let change = 0; for (let i = 0; i < n; i++) { const nv = x[i] * g[i] / Hx[i]; change += Math.abs(nv - x[i]); x[i] = nv; }
    if (change < 1e-8 * n) break;
  }
  return x;
}
function computeG(dict, spec) {
  const g = new Float64Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * spec[b]; g[i] = Math.max(s, 1e-12); }
  return g;
}
function nnlsDetect(s, sr, dict, H, maxIter, threshold, maxNotes) {
  const mag = computeMag(s); const g = computeG(dict, mag); const acts = solveNNLS(H, g, maxIter);
  const notes = []; for (let ni = 0; ni < NOTE_COUNT; ni++) if (acts[ni] > 0) notes.push({ ni, midi: NOTE_MIN + ni, act: acts[ni] });
  notes.sort((a, b) => b.act - a.act);
  const kept = [];
  for (const n of notes) {
    let ih = false; for (const k of kept) { const r = Math.pow(2, (n.midi - k.midi) / 12); if (r > 1.8 && r < 2.2 || r > 2.8 && r < 3.2) { ih = true; break; } }
    if (!ih) { kept.push(n); if (kept.length >= maxNotes) break; }
  }
  const maxA = kept.length ? kept[0].act : 1;
  return kept.filter(n => n.act / maxA > threshold).map(n => ({ freq: Math.round(440 * Math.pow(2, (n.midi - 69) / 12) * 10) / 10, midi: n.midi, conf: Math.min(1, n.act / maxA) }));
}

// === Detector routing ===
function detectChunk(signal, offset, minF, maxF, minConf, instrument, method, dict, H, nnlsCfg) {
  const a = 1 - 2 * Math.PI * (instrument === 'guitar' ? 200 : 40) / SR;
  const hp = new Float64Array(signal.length); let y = 0;
  for (let i = 1; i < signal.length; i++) { y = signal[i] - signal[i - 1] + a * y; hp[i] = y; }
  const sig = instrument === 'bass' ? (() => { const o = new Float64Array(signal.length); let ly = 0; for (let i = 0; i < signal.length; i++) { ly = ly * 0.996 + hp[i] * (1 - 0.996); o[i] = ly; } return o; })() : hp;
  const tf = Math.floor((sig.length - FFT_SIZE) / HOP) + 1;
  const raw = [];
  for (let fi = 0; fi < tf; fi++) {
    const frame = sig.slice(fi * HOP, fi * HOP + FFT_SIZE);
    let dets;
    if (method === 'swipe') dets = swipeIterDetect(frame, SR, swipeKernels, nnlsCfg.maxNotes, 0.05);
    else if (method === 'swipe8') dets = swipeIterDetect(frame, SR, swipeKernels8, nnlsCfg.maxNotes, 0.05);
    else if (method === 'swipe12') dets = swipeIterDetect(frame, SR, swipeKernels12, nnlsCfg.maxNotes, 0.05);
    else dets = nnlsDetect(frame, SR, dict, H, nnlsCfg.iters, nnlsCfg.threshold, nnlsCfg.maxNotes);
    for (const d of dets) {
      if (d.freq > minF && d.freq < maxF && d.conf > minConf) raw.push({ time: offset + fi * HOP / SR, freq: d.freq, midi: f2m(d.freq), conf: d.conf });
    }
  }
  const active = {}, notes = [], GAP = 0.05;
  for (const n of raw) { const r = Math.round(n.midi); if (active[r]) { if (n.time - active[r].last > GAP) { const dur = active[r].last - active[r].start; if (dur > 0.04 && active[r].count >= 2) notes.push({ midi: r, freq: active[r].freqSum / active[r].count, start: active[r].start, dur, conf: active[r].conf, instrument }); active[r] = { freqSum: n.freq, conf: n.conf, start: n.time, last: n.time, count: 1 }; } else { active[r].freqSum += n.freq; active[r].conf = Math.max(active[r].conf, n.conf); active[r].last = n.time; active[r].count++; } } else { active[r] = { freqSum: n.freq, conf: n.conf, start: n.time, last: n.time, count: 1 }; } }
  for (const [r, a] of Object.entries(active)) { const dur = a.last - a.start; if (a.count >= 2 && dur > 0.04) notes.push({ midi: parseInt(r), freq: a.freqSum / a.count, start: a.start, dur, conf: a.conf, instrument }); }
  return notes.sort((a, b) => a.start - b.start);
}

function matchChunk(det, gtList, startTime, endTime) {
  const gw = gtList.filter(g => g.time >= startTime - 0.5 && g.time < endTime + 0.5);
  const dw = det.filter(d => d.start >= startTime && d.start < endTime);
  let tp = 0, fp = 0, matched = new Set();
  for (const d of dw) { let found = false; for (let gi = 0; gi < gw.length; gi++) { if (matched.has(gi)) continue; const g = gw[gi]; if (Math.abs(d.start - g.time) < 0.15 && Math.abs(d.midi - g.midi) < 1.5) { tp++; matched.add(gi); found = true; break; } } if (!found) fp++; }
  return { tp, fp, fn: gw.length - matched.size, det: dw.length, gt: gw.length };
}

// === MIDI GT ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;
const gt = [];
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, active = {};
  for (const e of track) { tick += e.deltaTime || 0; const sec = tick / ppq * spb; if (sec > 432) break; if (e.type === 'noteOn' && e.velocity > 0) active[e.noteNumber] = { tick, freq: 440 * Math.pow(2, (e.noteNumber - 69) / 12) }; if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) { if (active[e.noteNumber]) { const st = active[e.noteNumber].tick / ppq * spb; const et = tick / ppq * spb; const instr = ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'other'; gt.push({ time: st, freq: active[e.noteNumber].freq, midi: 12 * Math.log2(active[e.noteNumber].freq / 440) + 69, dur: et - st, instr }); delete active[e.noteNumber]; } } }
}
gt.sort((a, b) => a.time - b.time);
const gtG = gt.filter(n => n.instr === 'guitar');
const gtB = gt.filter(n => n.instr === 'bass');
console.log(`GT: ${gt.length} (g:${gtG.length} b:${gtB.length})`);

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff, sr;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'fmt ') sr = buf.readUInt32LE(off + 12); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const totalFrames = Math.floor((buf.length - dataOff) / 4);
function readChunk(ci) {
  const start = ci * 10 * SR, dur = Math.min(10 * SR, totalFrames - start);
  const mono = new Float64Array(dur);
  for (let i = 0; i < dur; i++) { const idx = (start + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
  return { mono, offset: start / SR, dur: dur / SR };
}

console.log('Building NNLS dictionary...');
const dict = buildDict(1.0, 10);
const H = precomputeH(dict);

const configs = [
  { label: '[NNLS] baseline', method: 'nnls', threshold: 0.05, iters: 50, maxNotes: 5 },
  { label: '[SWIPE] 10 harm', method: 'swipe', threshold: 0.3, iters: 0, maxNotes: 5 },
  { label: '[SWIPE] 8 harm', method: 'swipe8', threshold: 0.3, iters: 0, maxNotes: 5 },
  { label: '[SWIPE] 12 harm', method: 'swipe12', threshold: 0.3, iters: 0, maxNotes: 5 },
];

const chunks = Math.ceil(totalFrames / SR / 10);

for (const cfg of configs) {
  console.log(`\n=== ${cfg.label} ===`);
  const total = { guitar: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 }, bass: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 } };
  const t0 = Date.now();
  const nnlsCfg = { threshold: cfg.threshold, iters: cfg.iters, maxNotes: cfg.maxNotes };

  for (let ci = 0; ci < chunks; ci++) {
    const { mono, offset, dur } = readChunk(ci); const end = offset + dur;
    process.stdout.write(`\r  ${ci+1}/${chunks} ${offset.toFixed(0)}s`);
    const g = detectChunk(mono, offset, 80, 1500, 0.2, 'guitar', cfg.method, dict, H, nnlsCfg);
    const b = detectChunk(mono, offset, 40, 180, 0.15, 'bass', cfg.method, dict, H, nnlsCfg);
    const gr = matchChunk(g, gtG, offset, end);
    const br = matchChunk(b, gtB, offset, end);
    total.guitar.tp += gr.tp; total.guitar.fp += gr.fp; total.guitar.fn += gr.fn; total.guitar.det += gr.det; total.guitar.gt += gr.gt;
    total.bass.tp += br.tp; total.bass.fp += br.fp; total.bass.fn += br.fn; total.bass.det += br.det; total.bass.gt += br.gt;
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`  ${elapsed.toFixed(0)}s`);
  for (const instr of ['guitar', 'bass']) {
    const t = total[instr];
    const p = t.tp / (t.tp + t.fp) || 0, r = t.tp / (t.tp + t.fn) || 0;
    const f1 = 2 * p * r / (p + r || 1) * 100;
    console.log(`  ${instr.toUpperCase()}: GT=${t.gt} Det=${t.det} TP=${t.tp} FP=${t.fp} FN=${t.fn}  Prec=${(p*100).toFixed(1)}% Rec=${(r*100).toFixed(1)}% F1=${f1.toFixed(1)}%`);
  }
}
