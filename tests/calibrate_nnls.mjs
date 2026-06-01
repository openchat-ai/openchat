// calibrate_nnls.mjs — NNLS multi-pitch detection vs V4 baseline
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
  const m = new Float64Array(HALF); for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); return m;
}

// === NNLS Dictionary (unit-normalized columns) ===
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

// Multiplicative update NNLS
function solveNNLS(H, g, maxIter) {
  const n = g.length;
  let x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = 1e-4;
  const Hx = new Float64Array(n);
  const eps = 1e-12;
  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * x[j]; Hx[i] = Math.max(s, eps); }
    let change = 0;
    for (let i = 0; i < n; i++) { const nv = x[i] * g[i] / Hx[i]; change += Math.abs(nv - x[i]); x[i] = nv; }
    if (change < 1e-8 * n) break;
  }
  return x;
}

function computeG(dict, spec) {
  const g = new Float64Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) {
    let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * spec[b];
    g[i] = Math.max(s, 1e-12);
  }
  return g;
}

// NNLS-based note detection per frame
function nnlsDetect(s, sr, dict, H, maxIter, threshold, maxNotes) {
  const mag = computeMag(s);
  const g = computeG(dict, mag);
  const acts = solveNNLS(H, g, maxIter);

  // Find notes: sort activations, suppress harmonics
  const notes = [];
  for (let ni = 0; ni < NOTE_COUNT; ni++) {
    if (acts[ni] > 0) notes.push({ ni, midi: NOTE_MIN + ni, act: acts[ni] });
  }
  notes.sort((a, b) => b.act - a.act);

  // Harmonic suppression: if a note is ~harmonic ratio of a stronger note, suppress it
  const kept = [];
  for (const n of notes) {
    const nm = n.midi;
    let isHarmonic = false;
    for (const k of kept) {
      const r = Math.pow(2, (nm - k.midi) / 12);
      if (r > 1.8 && r < 2.2) { isHarmonic = true; break; } // octave
      if (r > 2.8 && r < 3.2) { isHarmonic = true; break; } // 12th
    }
    if (!isHarmonic) {
      kept.push(n);
      if (kept.length >= maxNotes) break;
    }
  }

  const maxAct = kept.length > 0 ? kept[0].act : 1;
  return kept
    .filter(n => n.act / maxAct > threshold && n.midi >= 21 && n.midi <= 108)
    .map(n => {
      const freq = 440 * Math.pow(2, (n.midi - 69) / 12);
      return { freq: Math.round(freq * 10) / 10, midi: n.midi, conf: Math.min(1, n.act / (maxAct + 1e-10)) };
    });
}

// === V4 fusion detectors (for baseline comparison) ===
function hpsDetect(s, sr) {
  const m = computeMag(s), hs = new Float64Array(HALF), ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
  for (let i = 0; i < HALF; i++) { let ss = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; ss += m[idx] * ww[h]; } hs[i] = ss; }
  const minB = Math.round(HALF * 40 / sr), maxB = Math.round(HALF * 1500 / sr);
  const peaks = []; let mPV = 0; for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > 0) { peaks.push({ i, v: hs[i] }); if (hs[i] > mPV) mPV = hs[i]; } }
  if (!peaks.length) return []; const flt = peaks.filter(p => p.v >= mPV * 0.3).sort((a, b) => b.v - a.v); const r = [];
  for (const p of flt) { const fq = p.i * sr / FFT_SIZE; const dup = r.some(r2 => Math.abs(fq / r2.freq - Math.round(fq / r2.freq)) < 0.08); if (!dup) { r.push({ freq: Math.round(fq * 10) / 10, conf: Math.min(1, p.v / mPV) }); if (r.length >= 3) break; } }
  return r;
}
function yinDetect(s, sr) {
  const minF = 80, maxF = 300;
  const maxLag = Math.round(sr / minF), minLag = Math.round(sr / maxF);
  const buf = s.length < FFT_SIZE ? (() => { const b = new Float64Array(FFT_SIZE); b.set(s); return b; })() : s.slice(0, FFT_SIZE);
  const diff = new Float64Array(maxLag);
  for (let tau = 0; tau < maxLag; tau++) { let d = 0; for (let i = 0; i < maxLag; i++) { const dd = buf[i] - buf[i + tau]; d += dd * dd; } diff[tau] = d; }
  const cm = new Float64Array(maxLag); cm[0] = 1; let rs = 0;
  for (let tau = 1; tau < maxLag; tau++) { rs += diff[tau]; cm[tau] = rs > 0 ? diff[tau] * tau / rs : 1; }
  let bl = 0, bv = 1;
  for (let tau = Math.max(minLag, 2); tau < maxLag; tau++) { if (cm[tau] < cm[tau - 1] && cm[tau] < cm[tau + 1]) { if (cm[tau] < 0.15) { bl = tau; bv = cm[tau]; break; } if (cm[tau] < bv) { bl = tau; bv = cm[tau]; } } }
  if (bl < minLag) return []; let rf = bl;
  if (bl > 0 && bl < maxLag - 1) { const a = cm[bl - 1], b = cm[bl], g = cm[bl + 1], de = a - 2 * b + g; if (Math.abs(de) > 1e-12) rf = bl + (a - g) / (2 * de); }
  const freq = sr / rf; const cf = Math.max(0, 1 - bv);
  if (freq > maxF || freq < minF) return [];
  return [{ freq: Math.round(freq * 10) / 10, conf: Math.round(cf * 100) / 100 }];
}
function multiPeakTrack(s, sr) {
  const m = computeMag(s), peaks = [];
  for (let i = 2; i < HALF - 2; i++) { if (m[i] > m[i - 1] && m[i] > m[i - 2] && m[i] > m[i + 1] && m[i] > m[i + 2]) { const a = m[i - 1], b = m[i], g = m[i + 1], de = a - 2 * b + g; let fi = i; if (Math.abs(de) > 1e-12) fi = i + (a - g) / (2 * de); peaks.push({ freq: fi * sr / FFT_SIZE, amp: b }); } }
  if (!peaks.length) return []; const ma = peaks.reduce((mm, p) => Math.max(mm, p.amp), 0);
  const f = peaks.filter(p => p.amp >= ma * 0.05 && p.freq >= 40 && p.freq <= 2000).sort((a, b) => b.amp - a.amp);
  const r = [], uf = []; for (const p of f) { const ih = uf.some(fq => { const rr = p.freq / fq; return rr > 1.5 && Math.abs(rr - Math.round(rr)) < 0.08; }); if (!ih) { r.push({ freq: Math.round(p.freq * 10) / 10, conf: Math.min(1, p.amp / ma) }); uf.push(p.freq); if (r.length >= 3) break; } }
  return r;
}
function fusionDetect(s, sr) {
  const h = hpsDetect(s, sr), y = yinDetect(s, sr), p = multiPeakTrack(s, sr);
  const all = [...h.map(n => ({ ...n, src: 'hps' })), ...y.map(n => ({ ...n, src: 'yin' })), ...p.map(n => ({ ...n, src: 'peak' }))];
  if (!all.length) return []; const cls = [];
  for (const note of all) { let found = false; for (const cl of cls) { const ratio = note.freq > cl.avg ? note.freq / cl.avg : cl.avg / note.freq; if (ratio < 1.03) { cl.notes.push(note); cl.avg = cl.notes.reduce((s, n) => s + n.freq, 0) / cl.notes.length; found = true; break; } } if (!found) cls.push({ notes: [note], avg: note.freq }); }
  const ww = { yin: 1, peak: 0.8, hps: 0.5 }, r = [];
  for (const cl of cls) { let wc = 0, tw = 0; const ss = new Set(); for (const note of cl.notes) { const w = ww[note.src] || 0.5; wc += note.conf * w; tw += w; ss.add(note.src); } const ac = tw > 0 ? wc / tw : 0; const bonus = ss.size > 1 ? 0.1 * (ss.size - 1) : 0; r.push({ freq: Math.round(cl.avg * 10) / 10, conf: Math.min(1, ac + bonus), srcCount: ss.size }); }
  r.sort((a, b) => b.conf - a.conf); return r.slice(0, 3);
}

// === Shared chunk detection and matching ===
function detectChunk(signal, offset, minF, maxF, minConf, instrument, method, dict, H, nnlsConfig) {
  const a = 1 - 2 * Math.PI * (instrument === 'guitar' ? 200 : 40) / SR;
  const hp = new Float64Array(signal.length); let y = 0;
  for (let i = 1; i < signal.length; i++) { y = signal[i] - signal[i - 1] + a * y; hp[i] = y; }
  const sig = instrument === 'bass' ? (() => { const o = new Float64Array(signal.length); let ly = 0; for (let i = 0; i < signal.length; i++) { ly = ly * 0.996 + hp[i] * (1 - 0.996); o[i] = ly; } return o; })() : hp;

  const tf = Math.floor((sig.length - FFT_SIZE) / HOP) + 1;
  const raw = [];

  for (let fi = 0; fi < tf; fi++) {
    const frame = sig.slice(fi * HOP, fi * HOP + FFT_SIZE);
    let dets;
    if (method === 'nnls') {
      dets = nnlsDetect(frame, SR, dict, H, nnlsConfig.iters, nnlsConfig.threshold, nnlsConfig.maxNotes);
    } else {
      dets = fusionDetect(frame, SR);
    }
    for (const d of dets) {
      if (d.freq > minF && d.freq < maxF && d.conf > minConf) {
        raw.push({ time: offset + fi * HOP / SR, freq: d.freq, midi: f2m(d.freq), conf: d.conf });
      }
    }
  }

  // state machine (same as V4)
  const active = {}, notes = [], GAP = 0.05;
  for (const n of raw) {
    const r = Math.round(n.midi);
    if (active[r]) {
      if (n.time - active[r].last > GAP) {
        const dur = active[r].last - active[r].start;
        if (dur > 0.04 && active[r].count >= 2) notes.push({ midi: r, freq: active[r].freqSum / active[r].count, start: active[r].start, dur, conf: active[r].conf, instrument });
        active[r] = { freqSum: n.freq, conf: n.conf, start: n.time, last: n.time, count: 1 };
      } else {
        active[r].freqSum += n.freq; active[r].conf = Math.max(active[r].conf, n.conf); active[r].last = n.time; active[r].count++;
      }
    } else {
      active[r] = { freqSum: n.freq, conf: n.conf, start: n.time, last: n.time, count: 1 };
    }
  }
  for (const [r, a] of Object.entries(active)) { const dur = a.last - a.start; if (a.count >= 2 && dur > 0.04) notes.push({ midi: parseInt(r), freq: a.freqSum / a.count, start: a.start, dur, conf: a.conf, instrument }); }
  notes.sort((a, b) => a.start - b.start);
  return notes;
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
console.log(`MIDI GT: ${gt.length} (guitar:${gtG.length} bass:${gtB.length} other:${gt.filter(n=>n.instr==='other').length})`);

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

// === Experiment configurations ===
const nnlsConfigs = [
  { label: 'NNLS th=0.05 it=50', threshold: 0.05, iters: 50, maxNotes: 5 },
  { label: 'NNLS th=0.10 it=50', threshold: 0.10, iters: 50, maxNotes: 5 },
  { label: 'NNLS th=0.20 it=50', threshold: 0.20, iters: 50, maxNotes: 5 },
  { label: 'NNLS th=0.05 it=100', threshold: 0.05, iters: 100, maxNotes: 5 },
  { label: 'NNLS th=0.10 it=100', threshold: 0.10, iters: 100, maxNotes: 5 },
  { label: 'NNLS th=0.05 it=50 max3', threshold: 0.05, iters: 50, maxNotes: 3 },
];

console.log('\n构建 NNLS 词典...');
const dict = buildDict(1.0, 10);
const H = precomputeH(dict);
console.log('完成。\n');

// Run V4 baseline first
for (const cfg of nnlsConfigs) {
  cfg.label = `[NNLS] ${cfg.threshold*100}% th ${cfg.iters}it max${cfg.maxNotes}`;
}

// V4 baseline
const experiments = [
  { label: '[V4] Fusion baseline', method: 'fusion', minConf: { guitar: 0.2, bass: 0.15 } },
  ...nnlsConfigs.map(cfg => ({
    label: cfg.label,
    method: 'nnls',
    nnlsConfig: { threshold: cfg.threshold, iters: cfg.iters, maxNotes: cfg.maxNotes },
    minConf: { guitar: 0.15, bass: 0.1 }
  })),
];

for (const exp of experiments) {
  const chunks = Math.ceil(totalFrames / sr / 10);
  console.log(`\n=== ${exp.label} ===`);
  const total = { guitar: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 }, bass: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 } };
  const t0 = Date.now();

  for (let ci = 0; ci < chunks; ci++) {
    const { mono, offset, dur } = readChunk(ci); const end = offset + dur;
    process.stdout.write(`\r  Chunk ${ci+1}/${chunks} (${offset.toFixed(0)}-${end.toFixed(0)}s)`);

    let g, b;
    if (exp.method === 'fusion') {
      g = detectChunk(mono, offset, 80, 1500, exp.minConf.guitar, 'guitar', 'fusion', null, null, null);
      b = detectChunk(mono, offset, 40, 180, exp.minConf.bass, 'bass', 'fusion', null, null, null);
    } else {
      g = detectChunk(mono, offset, 80, 1500, exp.minConf.guitar, 'guitar', 'nnls', dict, H, exp.nnlsConfig);
      b = detectChunk(mono, offset, 40, 180, exp.minConf.bass, 'bass', 'nnls', dict, H, exp.nnlsConfig);
    }

    const gr = matchChunk(g, gtG, offset, end);
    const br = matchChunk(b, gtB, offset, end);
    total.guitar.tp += gr.tp; total.guitar.fp += gr.fp; total.guitar.fn += gr.fn; total.guitar.det += gr.det; total.guitar.gt += gr.gt;
    total.bass.tp += br.tp; total.bass.fp += br.fp; total.bass.fn += br.fn; total.bass.det += br.det; total.bass.gt += br.gt;
  }

  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\n  用时: ${elapsed.toFixed(0)}s`);

  for (const instr of ['guitar', 'bass']) {
    const t = total[instr];
    const p = t.tp / (t.tp + t.fp) || 0, r = t.tp / (t.tp + t.fn) || 0;
    const f1 = 2 * p * r / (p + r || 1) * 100;
    console.log(`  ${instr.toUpperCase()}: GT=${t.gt} Det=${t.det} TP=${t.tp} FP=${t.fp} FN=${t.fn}  Prec=${(p*100).toFixed(1)}% Rec=${(r*100).toFixed(1)}% F1=${f1.toFixed(1)}%`);
  }
}
