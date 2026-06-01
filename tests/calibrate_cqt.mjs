// calibrate_cqt.mjs — CQT + NNLS vs FFT + NNLS vs FFT + Fusion
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000;
const NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = NOTE_MAX - NOTE_MIN + 1;
const HOP = 1024;

function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wi * re[v] + wr * im[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function computeMag(s, fftSize) {
  const half = fftSize >> 1;
  const win = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  for (let i = 0; i < Math.min(s.length, fftSize); i++) re[i] = s[i] * win[i];
  fft(re, im, fftSize);
  const m = new Float64Array(half); for (let i = 0; i < half; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return m;
}

// === CQT kernel ===
// Build sparse spectral kernel: each CQT bin = weighted sum of FFT bins around target frequency
// Returns { kernel: { bin: number, weight: number }[] for each CQT bin, nCqt: number }
function buildCqtKernel(sr, fftSize, binsPerOctave, midiMin, midiMax) {
  const half = fftSize >> 1;
  const Q = 1 / (Math.pow(2, 1 / binsPerOctave) - 1);  // about 34 for 24 bins/octave
  const nCqt = midiMax - midiMin + 1;
  const kernels = [];

  for (let mi = midiMin; mi <= midiMax; mi++) {
    const f0 = 440 * Math.pow(2, (mi - 69) / 12);
    const bw = f0 / Q;       // bandwidth for this bin
    const fftBin = Math.round(f0 * fftSize / sr);
    const bwBins = Math.max(1, Math.round(bw * fftSize / sr));

    const entries = [];
    const lo = Math.max(0, fftBin - 3 * bwBins);
    const hi = Math.min(half - 1, fftBin + 3 * bwBins);
    let totalW = 0;

    for (let b = Math.round(lo); b <= Math.round(hi); b++) {
      const dist = (b - fftBin) / bwBins;
      const w = Math.exp(-dist * dist);  // Gaussian window
      entries.push({ bin: b, weight: w });
      totalW += w;
    }

    // Normalize
    for (const e of entries) e.weight /= totalW;
    kernels.push(entries);
  }
  return kernels;
}

function applyCQT(mag, kernels) {
  const r = new Float64Array(kernels.length);
  for (let ki = 0; ki < kernels.length; ki++) {
    let s = 0;
    for (const e of kernels[ki]) s += mag[e.bin] * e.weight;
    r[ki] = s;
  }
  return r;
}

// === NNLS (generalized for any number of spectral bins) ===
function buildDict(nSpectralBins, fftSize, sr, harmDecay, harmCap, isCqt) {
  const dict = new Float64Array(nSpectralBins * NOTE_COUNT);
  for (let ni = 0; ni < NOTE_COUNT; ni++) {
    const freq = 440 * Math.pow(2, (NOTE_MIN + ni - 69) / 12);
    for (let h = 1; h <= harmCap; h++) {
      const hf = freq * h; if (hf > sr / 2) break;
      let bin;
      if (isCqt) {
        bin = Math.round(12 * Math.log2(hf / 440) + 69) - NOTE_MIN;
      } else {
        bin = Math.round(hf * fftSize / sr);
      }
      if (bin < 0 || bin >= nSpectralBins) continue;
      dict[bin * NOTE_COUNT + ni] += Math.pow(h, -harmDecay);
    }
  }
  // Normalize columns
  for (let ni = 0; ni < NOTE_COUNT; ni++) {
    let s = 0;
    for (let bi = 0; bi < nSpectralBins; bi++) {
      const v = dict[bi * NOTE_COUNT + ni];
      s += v * v;
    }
    const n = Math.sqrt(s) || 1;
    for (let bi = 0; bi < nSpectralBins; bi++) dict[bi * NOTE_COUNT + ni] /= n;
  }
  return dict;
}

function precomputeH(dict, nSpectralBins) {
  const H = new Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) {
    H[i] = new Float64Array(NOTE_COUNT);
    for (let j = 0; j < NOTE_COUNT; j++) {
      let s = 0;
      for (let b = 0; b < nSpectralBins; b++) s += dict[b * NOTE_COUNT + i] * dict[b * NOTE_COUNT + j];
      H[i][j] = s;
    }
  }
  return H;
}

function computeG(dict, spec, nSpectralBins) {
  const g = new Float64Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) {
    let s = 0;
    for (let b = 0; b < nSpectralBins; b++) s += dict[b * NOTE_COUNT + i] * spec[b];
    g[i] = Math.max(s, 1e-12);
  }
  return g;
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

function nnlsDetectGen(s, sr, fftSize, dict, H, nSpectralBins, kernels, threshold, maxNotes, useCqt) {
  const mag = computeMag(s, fftSize);
  const spec = useCqt ? applyCQT(mag, kernels) : mag;
  const g = computeG(dict, spec, nSpectralBins);
  const acts = solveNNLS(H, g, 50);
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

// === Fusion (same as before) ===
const FFT_SIZE_FUSION = 2048, HALF = FFT_SIZE_FUSION >> 1;
function hpsDetect(s, sr) {
  const m = computeMag(s, 2048), hs = new Float64Array(HALF), ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
  for (let i = 0; i < HALF; i++) { let ss = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; ss += m[idx] * ww[h]; } hs[i] = ss; }
  const minB = Math.round(HALF * 40 / sr), maxB = Math.round(HALF * 1500 / sr);
  const peaks = []; let mPV = 0; for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > 0) { peaks.push({ i, v: hs[i] }); if (hs[i] > mPV) mPV = hs[i]; } }
  if (!peaks.length) return []; const flt = peaks.filter(p => p.v >= mPV * 0.3).sort((a, b) => b.v - a.v); const r = [];
  for (const p of flt) { const fq = p.i * sr / FFT_SIZE_FUSION; const dup = r.some(r2 => Math.abs(fq / r2.freq - Math.round(fq / r2.freq)) < 0.08); if (!dup) { r.push({ freq: Math.round(fq * 10) / 10, conf: Math.min(1, p.v / mPV) }); if (r.length >= 3) break; } }
  return r.map(n => ({ ...n, src: 'hps' }));
}
function yinDetect(s, sr) {
  const minF = 80, maxF = 300, maxLag = Math.round(sr / minF), minLag = Math.round(sr / maxF);
  const buf = s.length < 2048 ? (() => { const b = new Float64Array(2048); b.set(s); return b; })() : s.slice(0, 2048);
  const diff = new Float64Array(maxLag);
  for (let tau = 0; tau < maxLag; tau++) { let d = 0; for (let i = 0; i < maxLag; i++) { const dd = buf[i] - buf[i + tau]; d += dd * dd; } diff[tau] = d; }
  const cm = new Float64Array(maxLag); cm[0] = 1; let rs = 0;
  for (let tau = 1; tau < maxLag; tau++) { rs += diff[tau]; cm[tau] = rs > 0 ? diff[tau] * tau / rs : 1; }
  let bl = 0, bv = 1;
  for (let tau = Math.max(minLag, 2); tau < maxLag; tau++) { if (cm[tau] < cm[tau - 1] && cm[tau] < cm[tau + 1]) { if (cm[tau] < 0.15) { bl = tau; bv = cm[tau]; break; } if (cm[tau] < bv) { bl = tau; bv = cm[tau]; } } }
  if (bl < minLag) return []; let rf = bl;
  if (bl > 0 && bl < maxLag - 1) { const a = cm[bl - 1], b = cm[bl], g = cm[bl + 1], de = a - 2 * b + g; if (Math.abs(de) > 1e-12) rf = bl + (a - g) / (2 * de); }
  const freq = sr / rf;
  if (freq > 300 || freq < 80) return [];
  return [{ freq: Math.round(freq * 10) / 10, conf: Math.round(Math.max(0, 1 - bv) * 100) / 100, src: 'yin' }];
}
function multiPeakTrack(s, sr) {
  const m = computeMag(s, 2048), peaks = [];
  for (let i = 2; i < HALF - 2; i++) { if (m[i] > m[i - 1] && m[i] > m[i - 2] && m[i] > m[i + 1] && m[i] > m[i + 2]) { const a = m[i - 1], b = m[i], g = m[i + 1], de = a - 2 * b + g; let fi = i; if (Math.abs(de) > 1e-12) fi = i + (a - g) / (2 * de); peaks.push({ freq: fi * sr / 2048, amp: b }); } }
  if (!peaks.length) return []; const ma = peaks.reduce((mm, p) => Math.max(mm, p.amp), 0);
  const f = peaks.filter(p => p.amp >= ma * 0.05 && p.freq >= 40 && p.freq <= 2000).sort((a, b) => b.amp - a.amp);
  const r = [], uf = []; for (const p of f) { const ih = uf.some(fq => { const rr = p.freq / fq; return rr > 1.5 && Math.abs(rr - Math.round(rr)) < 0.08; }); if (!ih) { r.push({ freq: Math.round(p.freq * 10) / 10, conf: Math.min(1, p.amp / ma), src: 'peak' }); uf.push(p.freq); if (r.length >= 3) break; } }
  return r;
}
function fusionDetect(s, sr) {
  const all = [...hpsDetect(s, sr), ...yinDetect(s, sr), ...multiPeakTrack(s, sr)]; if (!all.length) return [];
  const cls = [];
  for (const n of all) { let f = false; for (const c of cls) { const r = n.freq > c.avg ? n.freq / c.avg : c.avg / n.freq; if (r < 1.03) { c.notes.push(n); c.avg = c.notes.reduce((s, n) => s + n.freq, 0) / c.notes.length; f = true; break; } } if (!f) cls.push({ notes: [n], avg: n.freq }); }
  const ww = { yin: 1, peak: 0.8, hps: 0.5 }, r = [];
  for (const c of cls) { let wc = 0, tw = 0; const ss = new Set(); for (const n of c.notes) { const w = ww[n.src] || 0.5; wc += n.conf * w; tw += w; ss.add(n.src); } const ac = tw > 0 ? wc / tw : 0; const bonus = ss.size > 1 ? 0.1 * (ss.size - 1) : 0; r.push({ freq: Math.round(c.avg * 10) / 10, conf: Math.min(1, ac + bonus) }); }
  r.sort((a, b) => b.conf - a.conf); return r.slice(0, 3);
}

// === Detector routing ===
function detectMethod(s, sr, method, fftSize, dict, H, nSpectralBins, kernels, threshold, maxNotes) {
  if (method === 'fusion') return fusionDetect(s, sr);
  const useCqt = method === 'cqt';
  return nnlsDetectGen(s, sr, fftSize, dict, H, nSpectralBins, kernels, threshold, maxNotes, useCqt);
}

function detectChunk(signal, offset, minF, maxF, minConf, instrument, method, fftSize, dict, H, nSpectralBins, kernels, threshold, maxNotes) {
  const a = 1 - 2 * Math.PI * (instrument === 'guitar' ? 200 : 40) / SR;
  const hp = new Float64Array(signal.length); let y = 0;
  for (let i = 1; i < signal.length; i++) { y = signal[i] - signal[i - 1] + a * y; hp[i] = y; }
  const sig = instrument === 'bass' ? (() => { const o = new Float64Array(signal.length); let ly = 0; for (let i = 0; i < signal.length; i++) { ly = ly * 0.996 + hp[i] * (1 - 0.996); o[i] = ly; } return o; })() : hp;
  const tf = Math.floor((sig.length - fftSize) / HOP) + 1;
  const raw = [];
  for (let fi = 0; fi < tf; fi++) {
    const frame = sig.slice(fi * HOP, fi * HOP + fftSize);
    const dets = detectMethod(frame, SR, method, fftSize, dict, H, nSpectralBins, kernels, threshold, maxNotes);
    for (const d of dets) {
      if (d.freq > minF && d.freq < maxF && (d.conf || 1) > minConf) raw.push({ time: offset + fi * HOP / SR, freq: d.freq, midi: f2m(d.freq), conf: d.conf || 1 });
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

// === Load MIDI GT ===
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

// === Load WAV ===
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

// === Configs ===
const configs = [
  { label: '[Fusion] 2048 FFT', method: 'fusion', fftSize: 2048 },
  { label: '[NNLS] 2048 FFT', method: 'nnls', fftSize: 2048 },
  { label: '[NNLS] 4096 FFT', method: 'nnls', fftSize: 4096 },
  { label: '[CQT] 24/oct 2048 FFT', method: 'cqt', fftSize: 2048 },
];

const chunks = Math.ceil(totalFrames / SR / 10);
console.log(`Testing ${chunks} chunks...`);

// Precompute CQT kernels (same for all configs that use CQT)
const cqtKernels = buildCqtKernel(SR, 2048, 24, 21, 108);
// Wider range CQT for 4096
const cqtKernels4096 = buildCqtKernel(SR, 4096, 24, 21, 108);

for (const cfg of configs) {
  const fftSize = cfg.fftSize;
  const half = fftSize >> 1;
  const nBins = cfg.method === 'cqt' ? NOTE_COUNT : half;

  console.log(`\n=== ${cfg.label} ===`);
  const kernels = cfg.method === 'cqt' ? (fftSize === 2048 ? cqtKernels : cqtKernels4096) : null;

  // Build dictionary for this spectral representation
  let dict, H;
    if (cfg.method !== 'fusion') {
      const isCqt = cfg.method === 'cqt';
      dict = buildDict(nBins, fftSize, SR, 1.0, 10, isCqt);
      H = precomputeH(dict, nBins);
    }

  const total = { guitar: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 }, bass: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 } };
  const t0 = Date.now();

  for (let ci = 0; ci < chunks; ci++) {
    const { mono, offset, dur } = readChunk(ci); const end = offset + dur;
    process.stdout.write(`\r  ${ci+1}/${chunks} ${offset.toFixed(0)}s`);
    const g = detectChunk(mono, offset, 80, 1500, cfg.method === 'fusion' ? 0.2 : 0.15, 'guitar', cfg.method, fftSize, dict, H, nBins, kernels, 0.05, 5);
    const b = detectChunk(mono, offset, 40, 180, cfg.method === 'fusion' ? 0.15 : 0.1, 'bass', cfg.method, fftSize, dict, H, nBins, kernels, 0.05, 5);
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
