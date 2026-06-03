// 实验三 V20：48kHz MDCT + LPC（残差编码）
// 对比 V18（纯 MDCT）— SNR=17.01dB
import fs from 'fs';

const SR = 48000, N = 96, BANDS = 16, LPC_ORDER = 10;
const V18_BITS = [4, 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];

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
function calcSnr(o, r) {
  const l = Math.min(o.length, r.length); let s = 0, n = 0;
  for (let i = 0; i < l; i++) { s += o[i] * o[i]; const d = o[i] - r[i]; n += d * d; }
  return n < 1e-20 ? 999 : 10 * Math.log10(s / n);
}

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

// LPC: Levinson-Durbin → 直接系数 a[]
// 使用归一化自相关避免数值爆炸
function lpc(sig, order) {
  const M = sig.length;
  const r = new Float64Array(order + 1);
  for (let i = 0; i <= order; i++) { let s = 0; for (let j = 0; j < M - i; j++) s += sig[j] * sig[j + i]; r[i] = s / M; }
  r[0] *= 1.0001;
  const a = new Float64Array(order + 1); a[0] = 1;
  const e = new Float64Array(order + 1); e[0] = r[0];
  for (let i = 1; i <= order; i++) {
    let sum = r[i];
    for (let j = 1; j < i; j++) sum -= a[j] * r[i - j];
    if (Math.abs(e[i - 1]) < 1e-20) { a[i] = 0; continue; }
    let ki = sum / e[i - 1];
    // 钳位到稳定区域
    if (Math.abs(ki) >= 0.95) ki = 0.95 * Math.sign(ki);
    a[i] = ki;
    for (let j = 1; j < i; j++) a[j] -= ki * a[i - j];
    e[i] = e[i - 1] * (1 - ki * ki);
  }
  return a;
}

// LPC 逆滤波：残差 = signal - predicted
// 使用前 order 个输入样本预测: x[n] - a[1]*x[n-1] - a[2]*x[n-2] - ...
function lpcInverseFilter(sig, a) {
  const order = a.length - 1;
  const out = new Float64Array(sig.length);
  for (let n = 0; n < sig.length; n++) {
    let pred = 0;
    for (let i = 1; i <= order && n - i >= 0; i++) pred += a[i] * sig[n - i];
    out[n] = sig[n] - pred;
  }
  return out;
}

// LPC 综合滤波：signal = 残差 + predicted
// 使用已解码样本预测: residual[n] + a[1]*out[n-1] + a[2]*out[n-2] + ...
function lpcSynthesis(residual, a) {
  const order = a.length - 1;
  const out = new Float64Array(residual.length);
  for (let n = 0; n < residual.length; n++) {
    let pred = 0;
    for (let i = 1; i <= order && n - i >= 0; i++) pred += a[i] * out[n - i];
    out[n] = residual[n] + pred;
  }
  return out;
}

// 比特流
class WB {
  constructor() { this.b = []; this.a = 0; this.n = 0; }
  w(v, bs) { this.a = (this.a << bs) | (v & ((1 << bs) - 1)); this.n += bs;
    while (this.n >= 8) { this.n -= 8; this.b.push((this.a >> this.n) & 0xFF); this.a = this.a & ((1 << this.n) - 1); } }
  f() { if (this.n > 0) this.b.push((this.a << (8 - this.n)) & 0xFF); return Buffer.from(this.b); }
}
class RB {
  constructor(d) { this.d = d; this.p = 0; this.a = 0; this.n = 0; }
  r(bs) { while (this.n < bs) { this.a = (this.a << 8) | (this.d[this.p++] || 0); this.n += 8; }
    this.n -= bs; const v = (this.a >> this.n) & ((1 << bs) - 1); this.a = this.a & ((1 << this.n) - 1); return v; }
}

// V18: 纯 MDCT（基准）
function encodeV18(sig, bits) {
  const bw = new WB();
  for (let b = 0; b < BANDS; b++) bw.w(bits[b], 3);
  const nf = Math.ceil(sig.length / N);
  for (let fi = 0; fi < nf; fi++) {
    const fr = new Float64Array(2 * N); const st = fi * N;
    for (let i = 0; i < 2 * N && st + i < sig.length; i++) fr[i] = sig[st + i];
    const X = fwdMdct(fr, N);
    for (let b = 0; b < BANDS; b++) {
      const bi = bits[b]; if (bi === 0) continue;
      const sb = Math.round(b * N / BANDS), eb = Math.round((b + 1) * N / BANDS);
      let mv = 0; for (let k = sb; k < eb; k++) if (Math.abs(X[k]) > mv) mv = Math.abs(X[k]);
      bw.w(Math.max(0, Math.min(255, Math.round(Math.log2(Math.max(mv, 1e-10)) * 16 + 128))), 8);
      if (mv < 1e-10) { for (let k = sb; k < eb; k++) bw.w(0, bi); continue; }
      const sc = 1 << (bi - 1);
      for (let k = sb; k < eb; k++) { const q = Math.round(X[k] * sc / mv); bw.w(Math.max(0, Math.min((1 << bi) - 1, q + sc)), bi); }
    }
    bw.w(0, 20);  // F0 占位
  }
  return bw.f();
}
function decodeV18(bs, bits, outLen) {
  const br = new RB(bs);
  const bv = []; for (let b = 0; b < BANDS; b++) bv.push(br.r(3));
  const nf = Math.ceil(outLen / N);
  const out = new Float64Array(outLen);
  let prevY = null;
  for (let fi = 0; fi < nf; fi++) {
    const Xq = new Float64Array(N);
    for (let b = 0; b < BANDS; b++) {
      const bi = bv[b]; if (bi === 0) continue;
      const mvIdx = br.r(8); const mv = Math.pow(2, (mvIdx - 128) / 16);
      const sb = Math.round(b * N / BANDS), eb = Math.round((b + 1) * N / BANDS);
      for (let k = sb; k < eb; k++) { const u = br.r(bi); Xq[k] = (u - (1 << (bi - 1))) * mv / (1 << (bi - 1)); }
    }
    br.r(20);  // F0 占位
    const y = invMdct(Xq, N);
    for (let i = 0; i < N && fi * N + i < outLen; i++) out[fi * N + i] = (prevY ? prevY[N + i] : 0) + y[i];
    prevY = y;
  }
  return out;
}

// V20: MDCT + LPC（残差编码）
const LPC_UPDATE_FREQ = 4;  // 每4块更新一次 LPC
function encodeV20(sig, bits) {
  const bw = new WB();
  for (let b = 0; b < BANDS; b++) bw.w(bits[b], 3);
  const nf = Math.ceil(sig.length / N);
  let lpcK = null;  // 当前 LPC 系数
  for (let fi = 0; fi < nf; fi++) {
    // LPC 更新：每 UPDATE_FREQ 块计算一次
    if (fi % LPC_UPDATE_FREQ === 0) {
      const st = fi * N;
      const win = new Float64Array(2 * N);
      for (let i = 0; i < 2 * N && st + i < sig.length; i++) win[i] = sig[st + i];
      lpcK = lpc(win, LPC_ORDER);
      // 写入 LPC：直接系数 16bit × order（不量化，测试概念）
      for (let i = 0; i < LPC_ORDER; i++) {
        const v = Math.round(lpcK[i] * 1000);  // 缩放以保留精度
        bw.w(v, 16);
      }
    }
    // 当前块
    const fr = new Float64Array(2 * N); const st = fi * N;
    for (let i = 0; i < 2 * N && st + i < sig.length; i++) fr[i] = sig[st + i];
    // LPC 逆滤波 → 残差
    const residual = lpcInverseFilter(fr, lpcK);
    // 残差 MDCT
    const X = fwdMdct(residual, N);
    for (let b = 0; b < BANDS; b++) {
      const bi = bits[b]; if (bi === 0) continue;
      const sb = Math.round(b * N / BANDS), eb = Math.round((b + 1) * N / BANDS);
      let mv = 0; for (let k = sb; k < eb; k++) if (Math.abs(X[k]) > mv) mv = Math.abs(X[k]);
      bw.w(Math.max(0, Math.min(255, Math.round(Math.log2(Math.max(mv, 1e-10)) * 16 + 128))), 8);
      if (mv < 1e-10) { for (let k = sb; k < eb; k++) bw.w(0, bi); continue; }
      const sc = 1 << (bi - 1);
      for (let k = sb; k < eb; k++) { const q = Math.round(X[k] * sc / mv); bw.w(Math.max(0, Math.min((1 << bi) - 1, q + sc)), bi); }
    }
    bw.w(0, 20);  // F0 占位
  }
  return bw.f();
}
function decodeV20(bs, bits, outLen) {
  const br = new RB(bs);
  const bv = []; for (let b = 0; b < BANDS; b++) bv.push(br.r(3));
  const nf = Math.ceil(outLen / N);
  const out = new Float64Array(outLen);
  let prevY = null;
  let lpcK = null;
  for (let fi = 0; fi < nf; fi++) {
    // 读取 LPC
    if (fi % LPC_UPDATE_FREQ === 0) {
      lpcK = new Float64Array(LPC_ORDER);
      for (let i = 0; i < LPC_ORDER; i++) {
        lpcK[i] = br.r(16) / 1000;  // 反缩放
      }
    }
    // 读取残差 MDCT
    const Xq = new Float64Array(N);
    for (let b = 0; b < BANDS; b++) {
      const bi = bv[b]; if (bi === 0) continue;
      const mvIdx = br.r(8); const mv = Math.pow(2, (mvIdx - 128) / 16);
      const sb = Math.round(b * N / BANDS), eb = Math.round((b + 1) * N / BANDS);
      for (let k = sb; k < eb; k++) { const u = br.r(bi); Xq[k] = (u - (1 << (bi - 1))) * mv / (1 << (bi - 1)); }
    }
    br.r(20);  // F0 占位
    // IMDCT → 残差时域
    const residual = invMdct(Xq, N);
    // LPC 综合滤波 → 原始信号
    const y = lpcSynthesis(residual, lpcK);
    for (let i = 0; i < N && fi * N + i < outLen; i++) out[fi * N + i] = (prevY ? prevY[N + i] : 0) + y[i];
    prevY = y;
  }
  return out;
}

// 主流程
const [,, wav] = process.argv;
const raw = readWav(wav || 'jzlg.wav', 200, 10);
console.log(`[V18 vs V20] ${(raw.pcm.length / raw.sr).toFixed(1)}s @ ${raw.sr}Hz`);

// V18 基准
console.log('\n===== V18 (48kHz MDCT N=96, 纯MDCT) =====');
const encV18 = encodeV18(raw.pcm, V18_BITS);
const decV18 = decodeV18(encV18, V18_BITS, raw.pcm.length);
const snrV18 = calcSnr(raw.pcm, decV18);
console.log(`  压缩: ${(encV18.length/1024).toFixed(0)}KB (${(raw.pcm.length*2/encV18.length).toFixed(1)}x)`);
console.log(`  SNR: ${snrV18.toFixed(2)} dB`);

// V20 LPC+MDCT
console.log('\n===== V20 (48kHz MDCT+LPC N=96, 残差编码) =====');
const encV20 = encodeV20(raw.pcm, V18_BITS);
const decV20 = decodeV20(encV20, V18_BITS, raw.pcm.length);
const snrV20 = calcSnr(raw.pcm, decV20);
console.log(`  压缩: ${(encV20.length/1024).toFixed(0)}KB (${(raw.pcm.length*2/encV20.length).toFixed(1)}x)`);
console.log(`  SNR: ${snrV20.toFixed(2)} dB`);
console.log(`  LPC 阶数: ${LPC_ORDER}, 更新频率: 每${LPC_UPDATE_FREQ}块 (${LPC_UPDATE_FREQ * N * 1000 / SR}ms)`);

console.log(`\n=== 汇总 ===`);
console.log(`V18: ${snrV18.toFixed(2)} dB (MDCT 纯)`);
console.log(`V20: ${snrV20.toFixed(2)} dB (MDCT+LPC, 差值: ${(snrV20 - snrV18).toFixed(2)} dB)`);

writeWav('v20_decoded.wav', decV20, SR);
process.exit(0);
