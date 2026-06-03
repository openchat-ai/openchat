// 实验三 V19：24kHz MDCT 编解码器（N=48，重算比特分配）
// 对比 V18（48kHz N=96）— 都是纯 MDCT 量化
import fs from 'fs';

// ===== 参数 =====
const SR_V19 = 24000, N_V19 = 48;   // 4ms帧
const SR_V18 = 48000, N_V18 = 96;   // 4ms帧
const BANDS = 16;

// V18 默认分配：13bits/帧，截断10500Hz
const V18_BITS = [4, 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
// V19 默认分配：24bits/帧，截断8250Hz，平滑衰减
const V19_BITS = [4, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0];

// ===== 工具 =====
function readWav(path, ss, ds) {
  const buf = fs.readFileSync(path); let o = 12, doff, sr;
  while (o < buf.length) { const id = buf.toString('ascii', o, o + 4); const sz = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(o + 12); if (id === 'data') { doff = o + 8; break; } o += 8 + sz; }
  const di = Math.round((ds || 10) * sr), si = Math.round((ss || 200) * sr);
  const m = new Float64Array(di);
  for (let i = 0; i < di; i++) { const idx = (si + i) * 2;
    m[i] = buf.readInt16LE(doff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(doff + (idx + 1) * 2) / 32768 * 0.5; }
  return { pcm: m, sr };
}
function writeWav(p, s, sr) {
  const n = s.length, d = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32768))), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40); fs.writeFileSync(p, Buffer.concat([h, d]));
}
function downmix(sig, sr, tgt) {
  if (sr === tgt) return Float64Array.from(sig);
  const r = tgt / sr; const o = new Float64Array(Math.round(sig.length * r));
  for (let i = 0; i < o.length; i++) { const si = i / r; const sf = Math.floor(si), f = si - sf;
    o[i] = sf + 1 < sig.length ? sig[sf] * (1 - f) + sig[sf + 1] * f : sig[Math.min(sf, sig.length - 1)]; }
  return o;
}
function calcSnr(o, r) {
  const l = Math.min(o.length, r.length); let s = 0, n = 0;
  for (let i = 0; i < l; i++) { s += o[i] * o[i]; const d = o[i] - r[i]; n += d * d; }
  return n < 1e-20 ? 999 : 10 * Math.log10(s / n);
}

// ===== MDCT =====
const _WIN = {}, _TAB = {}, _ITAB = {};
function _mdct(N) {
  if (!_WIN[N]) { const w = new Float64Array(2 * N); for (let i = 0; i < 2 * N; i++) w[i] = Math.sin(Math.PI * (i + 0.5) / (2 * N)); _WIN[N] = w; }
  if (!_TAB[N]) { const t = new Float64Array(N * 2 * N); for (let k = 0; k < N; k++) for (let i = 0; i < 2 * N; i++) t[k * 2 * N + i] = Math.cos(Math.PI / N * (i + 0.5 + N / 2) * (k + 0.5)); _TAB[N] = t; }
  if (!_ITAB[N]) { const t = new Float64Array(2 * N * N); for (let i = 0; i < 2 * N; i++) for (let k = 0; k < N; k++) t[i * N + k] = Math.cos(Math.PI / N * (i + 0.5 + N / 2) * (k + 0.5)); _ITAB[N] = t; }
}
function fwdMdct(x, N) { _mdct(N); const X = new Float64Array(N);
  for (let k = 0; k < N; k++) { let s = 0; const r = k * 2 * N; for (let i = 0; i < 2 * N; i++) s += x[i] * _WIN[N][i] * _TAB[N][r + i]; X[k] = s; } return X; }
function invMdct(X, N) { _mdct(N); const y = new Float64Array(2 * N);
  for (let i = 0; i < 2 * N; i++) { let s = 0; const r = i * N; for (let k = 0; k < N; k++) s += X[k] * _ITAB[N][r + k]; y[i] = s * (2 / N) * _WIN[N][i]; } return y; }

// ===== 比特流 =====
class WB { constructor() { this.b = []; this.a = 0; this.n = 0; }
  w(v, bs) { this.a = (this.a << bs) | (v & ((1 << bs) - 1)); this.n += bs;
    while (this.n >= 8) { this.n -= 8; this.b.push((this.a >> this.n) & 0xFF); this.a = this.a & (1 << this.n) - 1; } }
  f() { if (this.n > 0) this.b.push((this.a << (8 - this.n)) & 0xFF); return Buffer.from(this.b); } }
class RB { constructor(d) { this.d = d; this.p = 0; this.a = 0; this.n = 0; }
  r(bs) { while (this.n < bs) { this.a = (this.a << 8) | (this.d[this.p++] || 0); this.n += 8; }
    this.n -= bs; const v = (this.a >> this.n) & ((1 << bs) - 1); this.a = this.a & ((1 << this.n) - 1); return v; } }

// ===== 编码/解码 =====
// 注意：忽略EPC头和F0占位，直接裸码流用于对比

function encodeAll(sig, N, bits) {
  const bw = new WB();
  for (let b = 0; b < BANDS; b++) bw.w(bits[b], 3);
  const nf = Math.ceil(sig.length / N);
  for (let fi = 0; fi < nf; fi++) {
    const fr = new Float64Array(2 * N); const st = fi * N;
    for (let i = 0; i < 2 * N && st + i < sig.length; i++) fr[i] = sig[st + i];
    const X = fwdMdct(fr, N);
    for (let b = 0; b < BANDS; b++) { const bi = bits[b]; if (bi === 0) continue;
      const sb = Math.round(b * N / BANDS), eb = Math.round((b + 1) * N / BANDS);
      let mv = 0; for (let k = sb; k < eb; k++) if (Math.abs(X[k]) > mv) mv = Math.abs(X[k]);
      bw.w(Math.max(0, Math.min(255, Math.round(Math.log2(Math.max(mv, 1e-10)) * 16 + 128))), 8);
      if (mv < 1e-10) { for (let k = sb; k < eb; k++) bw.w(0, bi); continue; }
      const sc = 1 << (bi - 1);
      for (let k = sb; k < eb; k++) { const q = Math.round(X[k] * sc / mv); bw.w(Math.max(0, Math.min((1 << bi) - 1, q + sc)), bi); }
    }
    bw.w(0, 7); bw.w(0, 5); bw.w(0, 4); bw.w(0, 1); bw.w(0, 3);
  }
  return bw.f();
}

function decodeAll(bs, N, bits, outLen) {
  const br = new RB(bs);
  const bv = []; for (let b = 0; b < BANDS; b++) bv.push(br.r(3));
  const nf = Math.ceil(outLen / N);
  const out = new Float64Array(outLen);
  let prevY = null;
  const firstFrame = { fi: 0 };
  for (let fi = 0; fi < nf; fi++) {
    const Xq = new Float64Array(N);
    for (let b = 0; b < BANDS; b++) { const bi = bv[b]; if (bi === 0) continue;
      const mvIdx = br.r(8); const mv = Math.pow(2, (mvIdx - 128) / 16);
      const sb = Math.round(b * N / BANDS), eb = Math.round((b + 1) * N / BANDS);
      for (let k = sb; k < eb; k++) { const u = br.r(bi); Xq[k] = (u - (1 << (bi - 1))) * mv / (1 << (bi - 1)); }
    }
    br.r(7); br.r(5); br.r(4); br.r(1); br.r(3);
    const y = invMdct(Xq, N);
    if (fi === 0) {
    }
    for (let i = 0; i < N && fi * N + i < outLen; i++) out[fi * N + i] = (prevY ? prevY[N + i] : 0) + y[i];
    prevY = y;
  }
  return out;
}

// ===== 主流程 =====
const [,, wav, ss, ds] = process.argv;
const raw = readWav(wav || 'jzlg.wav', parseFloat(ss || '200'), parseFloat(ds || '10'));
console.log(`[V18 vs V19] ${(raw.pcm.length / raw.sr).toFixed(1)}s @ ${raw.sr}Hz`);

// === V18 (48kHz N=96) ===
console.log('\n===== V18 (48kHz MDCT N=96, 原版比特) =====');
console.log('raw.pcm.length='+raw.pcm.length+' RMS='+Math.sqrt(raw.pcm.reduce((s,v)=>s+v*v,0)/raw.pcm.length).toFixed(5));
const enc18 = encodeAll(raw.pcm, N_V18, V18_BITS);
const recon18 = decodeAll(enc18, N_V18, V18_BITS, raw.pcm.length);
const s18 = calcSnr(raw.pcm, recon18);
console.log(`  压缩: ${(enc18.length/1024).toFixed(0)}KB (${(raw.pcm.length*2/enc18.length).toFixed(1)}x)`);
console.log(`  SNR: ${s18.toFixed(2)} dB`);
console.log('First 8 orig:', Array.from(raw.pcm.slice(0,8)).map(v=>v.toFixed(5)).join(','));
console.log('First 8 dec:', Array.from(recon18.slice(0,8)).map(v=>v.toFixed(5)).join(','));
fs.writeFileSync('v18_from_script.bin', enc18);

// === V19 (24kHz N=48) ===
console.log('\n===== V19 (24kHz MDCT N=48, 新比特分配) =====');
const sig24 = downmix(raw.pcm, raw.sr, SR_V19);
console.log('sig24.length='+sig24.length+' RMS='+Math.sqrt(sig24.reduce((s,v)=>s+v*v,0)/sig24.length).toFixed(5));
const enc19 = encodeAll(sig24, N_V19, V19_BITS);
const recon19 = decodeAll(enc19, N_V19, V19_BITS, sig24.length);
const s19 = calcSnr(sig24, recon19);
console.log(`  压缩: ${(enc19.length/1024).toFixed(0)}KB (${(sig24.length*2/enc19.length).toFixed(1)}x)`);
console.log(`  SNR: ${s19.toFixed(2)} dB`);

// 噪声
const noise19 = new Float64Array(recon19.length);
for (let i = 0; i < recon19.length; i++) noise19[i] = sig24[i] - recon19[i];
writeWav('v19_decoded.wav', recon19, SR_V19);
writeWav('v19_noise.wav', noise19, SR_V19);

// V18 噪声（估计在48kHz下的噪声，用于对比频段分布）
const noise18e = new Float64Array(recon18.length);
for (let i = 0; i < recon18.length; i++) noise18e[i] = raw.pcm[i] - recon18[i];
writeWav('v18_noise.wav', noise18e, SR_V18);

// 频段分布分析
function bandAnalysis(sig, noise, sr, label) {
  const fftSize = 1024;
  const noiseSpec = new Float64Array(fftSize / 2);
  let nf = 0;
  for (let fi = 0; fi + fftSize < noise.length; fi += fftSize / 2) {
    const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) re[i] = noise[fi + i];
    for (let i = 1, j = 0; i < fftSize; i++) { let b = fftSize >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let l = 2; l <= fftSize; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < fftSize; i += l) for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } }
    for (let k = 0; k < fftSize / 2; k++) noiseSpec[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    nf++;
  }
  for (let k = 0; k < fftSize / 2; k++) noiseSpec[k] /= nf;
  const bwHz = sr / fftSize;
  const bands = [];
  for (let b = 0; b < 12; b++) {
    const st = Math.round(b * fftSize / 2 / 12), en = Math.round((b + 1) * fftSize / 2 / 12);
    let e = 0; for (let k = st; k < en; k++) e += noiseSpec[k];
    bands.push({ f: `${Math.round(st * bwHz)}-${Math.round(en * bwHz)}Hz`, e: e.toFixed(3) });
  }
  console.log(`\n${label} 噪声频段分布:`);
  console.log(bands.map(b => `  ${b.f}: ${b.e}`).join('\n'));
}

bandAnalysis(raw.pcm, noise18e, SR_V18, 'V18');
bandAnalysis(sig24, noise19, SR_V19, 'V19');

console.log(`\n=== 汇总 ===`);
console.log(`V18: ${(enc18.length*8/10).toFixed(0)}bps SNR=${s18.toFixed(1)}dB 有效带宽~10500Hz`);
console.log(`V19: ${(enc19.length*8/10).toFixed(0)}bps SNR=${s19.toFixed(1)}dB 有效带宽~8250Hz`);

process.exit(0);
