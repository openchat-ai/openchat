import fs from 'fs';

const SR = 48000, N = 96, ORDER = 20, BANDS = 16;

function readWav(path) {
  const buf = fs.readFileSync(path); let off = 12, dataOff, frames;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; frames = sz / 2; break; }
    off += 8 + sz;
  }
  const m = new Float64Array(frames);
  for (let i = 0; i < frames; i++) m[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  return m;
}
function writeWav(path, s) {
  const n = s.length; const d = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32768))), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4);
  h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(path, Buffer.concat([h, d]));
}

// MDCT (N=96)
const win = new Float64Array(2 * N); for (let i = 0; i < 2 * N; i++) win[i] = Math.sin(Math.PI * (i + 0.5) / (2 * N));
const tab = new Float64Array(N * 2 * N); for (let k = 0; k < N; k++) for (let n = 0; n < 2 * N; n++) tab[k * 2 * N + n] = Math.cos(Math.PI / N * (n + 0.5 + N / 2) * (k + 0.5));
const itab = new Float64Array(2 * N * N); for (let n = 0; n < 2 * N; n++) for (let k = 0; k < N; k++) itab[n * N + k] = Math.cos(Math.PI / N * (n + 0.5 + N / 2) * (k + 0.5));
function mdct(x) { const X = new Float64Array(N); for (let k = 0; k < N; k++) { let s = 0; const r = k * 2 * N; for (let n = 0; n < 2 * N; n++) s += x[n] * win[n] * tab[r + n]; X[k] = s; } return X; }
function imdct(X) { const y = new Float64Array(2 * N); for (let n = 0; n < 2 * N; n++) { let s = 0; const r = n * N; for (let k = 0; k < N; k++) s += X[k] * itab[r + k]; y[n] = s * (2 / N) * win[n]; } return y; }

// LPC
function lpc(sig) {
  const r = new Float64Array(ORDER + 1); for (let i = 0; i <= ORDER; i++) { let s = 0; for (let j = 0; j < sig.length - i; j++) s += sig[j] * sig[j + i]; r[i] = s; }
  r[0] *= 1.01; const a = new Float64Array(ORDER + 1); a[0] = 1; const e = new Float64Array(ORDER + 1); e[0] = r[0];
  for (let i = 1; i <= ORDER; i++) {
    let k = r[i]; for (let j = 1; j < i; j++) k -= a[j] * r[i - j];
    if (Math.abs(e[i - 1]) < 1e-20) { a.fill(0); a[0] = 1; return a; }
    k /= e[i - 1]; if (Math.abs(k) >= 1) k = 0.99 * Math.sign(k);
    a[i] = k; for (let j = 1; j < i; j++) a[j] -= k * a[i - j];
    e[i] = e[i - 1] * (1 - k * k);
  }
  return a;
}

// 密集比特流
class BW {
  constructor() { this.b = []; this.a = 0; this.n = 0; }
  w(v, bits) {
    this.a = (this.a << bits) | (v & ((1 << bits) - 1)); this.n += bits;
    while (this.n >= 8) { this.n -= 8; this.b.push((this.a >> this.n) & 0xFF); this.a &= (1 << this.n) - 1; }
  }
  f() { if (this.n > 0) this.b.push((this.a << (8 - this.n)) & 0xFF); return Buffer.from(this.b); }
}

// ===== Main =====
console.log('='.repeat(60));
console.log('实验一：LPC + MDCT（能量分析+固定位分配）');
console.log('='.repeat(60));

const wav = readWav('tts_speech.wav');
const stride = N, total = wav.length, nf = Math.ceil((total - 2 * N) / stride) + 1;
console.log(`\n输入: ${wav.length}样点 = ${(wav.length/SR).toFixed(1)}s @${SR}Hz  ${(total*2/1024).toFixed(0)}KB`);

// ===== Step 1: 扫描全曲能量 =====
console.log('\n[能量扫描]');
const bandEnergy = new Float64Array(BANDS);
for (let fi = 0; fi < Math.min(nf, 500); fi++) {
  const st = fi * stride; const fr = new Float64Array(2 * N);
  for (let i = 0; i < 2 * N; i++) fr[i] = (st + i) < total ? wav[st + i] : 0;
  const X = mdct(fr);
  for (let b = 0; b < BANDS; b++) {
    let e = 0; for (let k = Math.round(b * N / BANDS); k < Math.round((b + 1) * N / BANDS); k++) e += X[k] * X[k];
    bandEnergy[b] += e;
  }
}
for (let b = 0; b < BANDS; b++) bandEnergy[b] /= Math.min(nf, 500);
console.log('  ' + Array.from(bandEnergy).map((v, i) => `带${i}:${(v*1e3).toFixed(0)}`).join(' '));

// ===== Step 2: 孤立能量检测 =====
const isolated = new Set();
for (let b = 1; b < BANDS - 1; b++) {
  const avgNB = (bandEnergy[b - 1] + bandEnergy[b + 1]) / 2;
  if (avgNB > 1 && bandEnergy[b] > avgNB * 1.8) isolated.add(b);
}
if (bandEnergy[0] > bandEnergy[1] * 1.5) isolated.add(0);
if (bandEnergy[BANDS - 1] > bandEnergy[BANDS - 2] * 1.5) isolated.add(BANDS - 1);
console.log(`  孤立能量带: ${isolated.size > 0 ? [...isolated].join(',') : '无'}`);

// ===== Step 3: 固定位分配 =====
const BASE = [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const bits = [...BASE];
for (const b of isolated)   bits[b] = Math.max(bits[b], 3);
console.log(`  位分配: ${bits.join(',')}`);
console.log(`  孤立带保护: ${isolated.size}带 (${[...isolated].join(',')})`);

// ===== Step 4: 编码 =====
console.log('\n[编码]');
const t0 = Date.now();
let pY = null, recon = [];
const bw = new BW();

// 文件头: 固定位分配
for (let b = 0; b < BANDS; b++) bw.w(bits[b], 3);

for (let fi = 0; fi < nf; fi++) {
  const st = fi * stride; const fr = new Float64Array(2 * N);
  for (let i = 0; i < 2 * N; i++) fr[i] = (st + i) < total ? wav[st + i] : 0;

  const a = lpc(fr);

  // LPC 每 8 帧
  if (fi % 8 === 0) for (let i = 1; i <= ORDER; i++) bw.w(Math.round((a[i] + 1) * 127) & 0xFF, 8);

  // MDCT → 量化
  let X = mdct(fr);
  const Xq = new Float64Array(N);
  for (let b = 0; b < BANDS; b++) {
    const bi = bits[b]; if (bi === 0) continue;
    const scale = 1 << (bi - 1);
    const stb = Math.round(b * N / BANDS), enb = Math.round((b + 1) * N / BANDS);
    let mv = 0; for (let k = stb; k < enb; k++) if (Math.abs(X[k]) > mv) mv = Math.abs(X[k]);
    if (mv < 1e-10) { for (let k = stb; k < enb; k++) bw.w(0, bi); continue; }
    for (let k = stb; k < enb; k++) {
      const q = Math.round(X[k] * scale / mv);
      bw.w(Math.max(0, Math.min((1 << bi) - 1, q + scale)), bi);
      Xq[k] = q * mv / scale;
    }
  }

  const y = imdct(Xq);
  for (let i = 0; i < N; i++) recon.push((pY ? pY[N + i] : 0) + y[i]);
  pY = y;
}

const t = (Date.now() - t0) / 1000;
const reconBuf = new Float64Array(recon);
const epcData = bw.f();

// 封装RFID帧: BB 01 CC [PL] [数据] [CS] 7E
const pl = epcData.length;
const frame = Buffer.alloc(6 + pl + 2);
let off = 0;
frame[off++] = 0xBB; frame[off++] = 0x01; frame[off++] = 0xCC;
frame[off++] = (pl >> 8) & 0xFF; frame[off++] = pl & 0xFF;
epcData.copy(frame, off); off += pl;
let cs = 0; for (let i = 1; i < off; i++) cs ^= frame[i];
frame[off++] = cs; frame[off++] = 0x7E;
const epcFrame = frame.slice(0, off);

// ===== 输出 =====
writeWav('exp1_lpc_mdct.wav', reconBuf);
fs.writeFileSync('exp1_lpc_mdct.epc', epcFrame);

const nm = Math.min(wav.length, reconBuf.length); let e = 0, o = 0;
for (let i = N; i < nm - N; i++) { const d = wav[i] - reconBuf[i]; e += d * d; o += wav[i] * wav[i]; }
const snr = e > 1e-20 ? (10 * Math.log10(o / e)).toFixed(1) + 'dB' : '∞dB';

console.log(`\n结果:`);
const epcFileSize = fs.statSync('exp1_lpc_mdct.epc').size;
console.log(`  时间: ${t}s (${nf}帧)`);
console.log(`  EPC: ${(epcFileSize/1024).toFixed(1)}KB (${((wav.length*2/1024)/(epcFileSize/1024)).toFixed(1)}×)`);
console.log(`  WAV: exp1_lpc_mdct.wav (${(reconBuf.length*2/1024).toFixed(0)}KB)`);
console.log(`  SNR: ${snr}`);
console.log(`  孤立能量带保护: ${isolated.size}带`);
