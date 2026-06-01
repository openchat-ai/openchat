// experiment4c_hpss.mjs — HPSS 预处理 + NNLS vs Raw NNLS
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, FFT_SIZE = 2048, HOP = 1024, HALF = FFT_SIZE >> 1;
const NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = NOTE_MAX - NOTE_MIN + 1;
const WIN_H = 11, WIN_P = 9; // HPSS windows

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));

function f2m(f) { return 12 * Math.log2(f / 440) + 69; }

function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } }
}
function computeMag(s) {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i];
  fft(re, im, FFT_SIZE);
  const m = new Float64Array(HALF); for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  return m;
}

// === NNLS ===
const dict = new Array(HALF); for (let b = 0; b < HALF; b++) dict[b] = new Float64Array(NOTE_COUNT);
for (let ni = 0; ni < NOTE_COUNT; ni++) {
  const freq = 440 * Math.pow(2, (NOTE_MIN + ni - 69) / 12);
  for (let h = 1; h <= 10; h++) { const hf = freq * h; if (hf > SR / 2) break; const bin = Math.round(hf * FFT_SIZE / SR); if (bin >= 0 && bin < HALF) dict[bin][ni] += Math.pow(h, -1.0); }
}
for (let ni = 0; ni < NOTE_COUNT; ni++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][ni] * dict[b][ni]; const n = Math.sqrt(s) || 1; for (let b = 0; b < HALF; b++) dict[b][ni] /= n; }
const Hmat = new Array(NOTE_COUNT);
for (let i = 0; i < NOTE_COUNT; i++) { Hmat[i] = new Float64Array(NOTE_COUNT); for (let j = 0; j < NOTE_COUNT; j++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * dict[b][j]; Hmat[i][j] = s; } }

function nnlsSolve(mag) {
  const N = NOTE_COUNT;
  const g = new Float64Array(N); for (let i = 0; i < N; i++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * mag[b]; g[i] = Math.max(s, 1e-12); }
  let x = new Float64Array(N); for (let i = 0; i < N; i++) x[i] = 1e-4;
  const Hx = new Float64Array(N); const eps = 1e-12;
  for (let it = 0; it < 50; it++) { for (let i = 0; i < N; i++) { let s = 0; for (let j = 0; j < N; j++) s += Hmat[i][j] * x[j]; Hx[i] = Math.max(s, eps); } let ch = 0; for (let i = 0; i < N; i++) { const nv = x[i] * g[i] / Hx[i]; ch += Math.abs(nv - x[i]); x[i] = nv; } if (ch < 1e-8 * N) break; }
  const notes = []; for (let ni = 0; ni < N; ni++) if (x[ni] > 0) notes.push({ ni, midi: NOTE_MIN + ni, act: x[ni] });
  notes.sort((a, b) => b.act - a.act); const kept = [];
  for (const n of notes) { let ih = false; for (const k of kept) { const r = Math.pow(2, (n.midi - k.midi) / 12); if (r > 1.8 && r < 2.2 || r > 2.8 && r < 3.2) { ih = true; break; } } if (!ih) { kept.push(n); if (kept.length >= 5) break; } }
  const maxA = kept.length ? kept[0].act : 1;
  return kept.filter(n => n.act / maxA > 0.05).map(n => ({ freq: Math.round(440 * Math.pow(2, (n.midi - 69) / 12) * 10) / 10, midi: n.midi, conf: Math.min(1, n.act / maxA) }));
}

// === HPSS per chunk ===
function buildMagSpec(sig) {
  const tf = Math.floor((sig.length - FFT_SIZE) / HOP) + 1;
  const mags = new Array(tf);
  for (let fi = 0; fi < tf; fi++) mags[fi] = computeMag(sig.slice(fi * HOP, fi * HOP + FFT_SIZE));
  return mags;
}

function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function hpssHarmonic(mags, wH, wP) {
  const T = mags.length, F = HALF;
  // Horizontal median → H
  const H = new Array(T);
  for (let t = 0; t < T; t++) H[t] = new Float64Array(F);

  // Compute H (across time)
  for (let b = 0; b < F; b++) {
    for (let t = 0; t < T; t++) {
      const lo = Math.max(0, t - wH), hi = Math.min(T - 1, t + wH);
      let minV = mags[lo][b], maxV = mags[lo][b];
      for (let t2 = lo; t2 <= hi; t2++) { const v = mags[t2][b]; if (v < minV) minV = v; if (v > maxV) maxV = v; }
      // Fast median using histogram for sorted values
      const vals = []; for (let t2 = lo; t2 <= hi; t2++) vals.push(mags[t2][b]);
      vals.sort((a, b) => a - b);
      H[t][b] = vals[Math.floor(vals.length / 2)];
    }
  }

  // P (across frequency) — only needed for masking
  const P = new Array(T);
  for (let t = 0; t < T; t++) P[t] = new Float64Array(F);

  for (let t = 0; t < T; t++) {
    for (let b = 0; b < F; b++) {
      const lo = Math.max(0, b - wP), hi = Math.min(F - 1, b + wP);
      const vals = []; for (let b2 = lo; b2 <= hi; b2++) vals.push(mags[t][b2]);
      vals.sort((a, b) => a - b);
      P[t][b] = vals[Math.floor(vals.length / 2)];
    }
  }

  // Wiener soft mask: H = H²/(H²+P²) * mag
  for (let t = 0; t < T; t++) {
    for (let b = 0; b < F; b++) {
      const h2 = H[t][b] * H[t][b];
      const p2 = P[t][b] * P[t][b];
      const mask = h2 / (h2 + p2 + 1e-15);
      H[t][b] = mags[t][b] * mask;
    }
  }
  return H;
}

// === Process chunk ===
function processChunk(sig, offset, minF, maxF, minConf, instrument, useHpss) {
  const a = 1 - 2 * Math.PI * (instrument === 'guitar' ? 200 : 40) / SR;
  const hp = new Float64Array(sig.length); let y = 0;
  for (let i = 1; i < sig.length; i++) { y = sig[i] - sig[i - 1] + a * y; hp[i] = y; }
  const filtered = instrument === 'bass' ? (() => { const o = new Float64Array(sig.length); let ly = 0; for (let i = 0; i < sig.length; i++) { ly = ly * 0.996 + hp[i] * (1 - 0.996); o[i] = ly; } return o; })() : hp;

  let mags;
  if (useHpss) {
    const rawMags = buildMagSpec(filtered);
    mags = hpssHarmonic(rawMags, WIN_H, WIN_P);
  } else {
    mags = buildMagSpec(filtered);
  }

  const raw = [];
  for (let fi = 0; fi < mags.length; fi++) {
    const dets = nnlsSolve(mags[fi]);
    for (const d of dets) {
      if (d.freq > minF && d.freq < maxF && d.conf > minConf) raw.push({ time: offset + fi * HOP / SR, freq: d.freq, midi: f2m(d.freq), conf: d.conf });
    }
  }

  // Frame tracking
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

const configs = [
  { label: '[Raw] NNLS', hpss: false },
  { label: '[HPSS-H] + NNLS', hpss: true },
];

const chunks = Math.ceil(totalFrames / SR / 10);

for (const cfg of configs) {
  console.log(`\n=== ${cfg.label} ===`);
  const total = { guitar: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 }, bass: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 } };
  const t0 = Date.now();

  for (let ci = 0; ci < chunks; ci++) {
    const { mono, offset, dur } = readChunk(ci); const end = offset + dur;
    process.stdout.write(`\r  ${ci+1}/${chunks} ${offset.toFixed(0)}s`);
    const g = processChunk(mono, offset, 80, 1500, 0.15, 'guitar', cfg.hpss);
    const b = processChunk(mono, offset, 40, 180, 0.1, 'bass', cfg.hpss);
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
