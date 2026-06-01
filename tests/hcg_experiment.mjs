// HCG（Harmonic Co-onset Gating）发明实验
// 核心思想：真实音符的所有泛音同时起振，能量时间序列高度相关
// 伪音符的泛音来自不同声源，能量波动独立
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10;
const HCG_WIN = 10; // ~210ms 滑动窗

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));

function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function computeMag(s) {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i]; fft(re, im, FFT_SIZE);
  const m = new Float64Array(HALF); for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); return m;
}

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

// ===== HCG: 谐波同注门控 =====
function extractHarmonicEnvelopes(magBuf, freq, sr) {
  // magBuf: [N x HALF] 缓冲，最新在最后
  const N = magBuf.length;
  const envs = [];
  for (let h = 1; h <= 5; h++) {
    const bin = Math.round(h * freq * FFT_SIZE / sr);
    if (bin <= 0 || bin >= HALF) { envs.push(null); continue; }
    const e = new Float64Array(N);
    for (let t = 0; t < N; t++) {
      // 取 bin 周边 3 点平均
      const m = magBuf[t];
      e[t] = (m[bin - 1] + m[bin] + m[bin + 1]) / 3;
    }
    envs.push(e);
  }
  return envs;
}

function pearson(x, y) {
  if (!x || !y || x.length < 3) return 0;
  let mx = 0, my = 0;
  for (let i = 0; i < x.length; i++) { mx += x[i]; my += y[i]; }
  mx /= x.length; my /= x.length;
  let cov = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    cov += dx * dy; sx += dx * dx; sy += dy * dy;
  }
  const den = Math.sqrt(sx * sy);
  return den < 1e-12 ? 0 : cov / den;
}

function computeHCG(magBuf, freq, sr) {
  const envs = extractHarmonicEnvelopes(magBuf, freq, sr);
  // 过滤 null（超出范围的泛音）
  const valid = envs.filter(e => e !== null);
  if (valid.length < 2) return 0;

  let sumR = 0, count = 0;
  for (let i = 0; i < valid.length; i++) {
    for (let j = i + 1; j < valid.length; j++) {
      sumR += pearson(valid[i], valid[j]);
      count++;
    }
  }
  return count > 0 ? sumR / count : 0;
}

// === MIDI GT（T5）===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spbP = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;
const gt = [];
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, active = {};
  for (const e of track) { tick += e.deltaTime || 0; const sec = tick / ppq * spbP; if (sec > T5_START + T5_DUR) break; if (e.type === 'noteOn' && e.velocity > 0) active[e.noteNumber] = { tick, freq: 440 * Math.pow(2, (e.noteNumber - 69) / 12) }; if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) { if (active[e.noteNumber]) { const st = active[e.noteNumber].tick / ppq * spbP; const et = tick / ppq * spbP; const instr = ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'other'; gt.push({ time: st - T5_START, freq: active[e.noteNumber].freq, midi: 12 * Math.log2(active[e.noteNumber].freq / 440) + 69, dur: et - st, instr }); delete active[e.noteNumber]; } } }
}
const gtG = gt.filter(n => n.instr === 'guitar');
console.log(`T5 GT guitar: ${gtG.length} notes`);

// === WAV（T5）===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

// === 检测 + HCG ===
const a = 1 - 2 * Math.PI * 200 / SR;
const hp = new Float64Array(mono.length); let yy = 0;
for (let i = 1; i < mono.length; i++) { yy = mono[i] - mono[i - 1] + a * yy; hp[i] = yy; }

const tf = Math.floor((hp.length - FFT_SIZE) / HOP) + 1;
const raw = [];
const magBuf = [];
const hopSec = HOP / SR;

for (let fi = 0; fi < tf; fi++) {
  const frame = hp.slice(fi * HOP, fi * HOP + FFT_SIZE);
  const mag = computeMag(frame);
  magBuf.push(mag);
  if (magBuf.length > HCG_WIN) magBuf.shift();
  if (magBuf.length < 4) continue; // 至少 4 帧才有统计意义

  const dets = fusionDetect(frame, SR);
  for (const d of dets) {
    if (d.freq < 80 || d.freq > 1500) continue;
    const hcg = computeHCG(magBuf, d.freq, SR);
    raw.push({ time: fi * hopSec, freq: d.freq, midi: f2m(d.freq), conf: d.conf, hcg });
  }
}

// === 分析 HCG 分布：TP vs FP ===
// 用帧级匹配（允许 150ms/1.5 semitone 窗口）
const matchFrame = (det, gtList) => {
  let best = null, bestD = Infinity;
  for (const g of gtList) {
    const dt = Math.abs(det.time - g.time);
    const dm = Math.abs(det.midi - g.midi);
    if (dt < 0.15 && dm < 1.5 && dt < bestD) { bestD = dt; best = g; }
  }
  return best;
};

const matchedGT = new Set();
const tpHCG = [], fpHCG = [], tpConf = [], fpConf = [];

for (const d of raw) {
  const g = matchFrame(d, gtG);
  if (g && !matchedGT.has(g)) {
    matchedGT.add(g);
    tpHCG.push(d.hcg);
    tpConf.push(d.conf);
  } else {
    fpHCG.push(d.hcg);
    fpConf.push(d.conf);
  }
}

const tpHcg = tpHCG, fpHcg = fpHCG;

const tpHcgMean = tpHcg.reduce((s, v) => s + v, 0) / Math.max(1, tpHcg.length);
const fpHcgMean = fpHcg.reduce((s, v) => s + v, 0) / Math.max(1, fpHcg.length);

console.log(`\n=== HCG 分布分析 ===`);
console.log(`TP: ${tpHcg.length} 个样本, 平均 HCG=${tpHcgMean.toFixed(3)}`);
console.log(`FP: ${fpHcg.length} 个样本, 平均 HCG=${fpHcgMean.toFixed(3)}`);

// 分桶统计
const bins = 5; const bw = 1 / bins;
const tpH = new Array(bins).fill(0), fpH = new Array(bins).fill(0);
for (const v of tpHcg) { const bi = Math.min(bins - 1, Math.floor(v / bw)); tpH[bi]++; }
for (const v of fpHcg) { const bi = Math.min(bins - 1, Math.floor(v / bw)); fpH[bi]++; }
console.log(`HCG分桶 (0-1):`);
for (let i = 0; i < bins; i++) {
  const lo = (i * bw).toFixed(1), hi = ((i + 1) * bw).toFixed(1);
  console.log(`  [${lo}-${hi})  TP=${tpH[i]}  FP=${fpH[i]}  ratio=${(tpH[i] / Math.max(1, tpH[i] + fpH[i]) * 100).toFixed(0)}%`);
}

// === 应用 HCG 门控后的效果 ===
console.log(`\n=== HCG 门控效果 ===`);
for (const th of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
  const filtered = raw.filter(d => d.hcg >= th);
  const gtp = new Set();
  let tp = 0, fp = 0;
  for (const d of filtered) {
    const g = matchFrame(d, gtG);
    if (g && !gtp.has(g)) { gtp.add(g); tp++; } else fp++;
  }
  const p = tp / (tp + fp) || 0, r = tp / gtG.length || 0;
  const f1 = 2 * p * r / (p + r || 1) * 100;
  console.log(`  门控 ${th.toFixed(1)}: TP=${tp} FP=${fp} Prec=${(p*100).toFixed(1)}% Rec=${(r*100).toFixed(1)}% F1=${f1.toFixed(1)}%`);
}

console.log(`\n原始（无门控）: TP=${tpHcg.length} FP=${fpHcg.length}`);
const p0 = tpHcg.length / (tpHcg.length + fpHcg.length) || 0;
const r0 = tpHcg.length / gtG.length || 0;
console.log(`  Prec=${(p0*100).toFixed(1)}% Rec=${(r0*100).toFixed(1)}% F1=${(2*p0*r0/(p0+r0||1)*100).toFixed(1)}%`);
