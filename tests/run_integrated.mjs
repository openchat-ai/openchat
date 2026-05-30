// 整合版编解码器：波形 LPC+MDCT + 扒谱 Fusion
// EPC含双数据段，解码后输出 WAV + 音高时间轴
import fs from 'fs';

const SR = 48000, N = 96, ORDER = 20, BANDS = 16;
const FUSION_INTERVAL = 4; // 每4帧(16ms)扒一次

// MDCT表
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

// --- Fusion扒谱 ---
function yinDetect(fr, sr) {
  const fs = 2048, mL = Math.ceil(sr / 2000), ML = Math.floor(sr / 40);
  if (fr.length < fs) return [];
  const d = new Float64Array(ML + 1); for (let t = 0; t <= ML; t++) { let s = 0; for (let i = 0; i < fs - t; i++) { const dd = fr[i] - fr[i + t]; s += dd * dd; } d[t] = s; }
  const c = new Float64Array(ML + 1); c[0] = 1; let rs = 0;
  for (let t = 1; t <= ML; t++) { rs += d[t]; c[t] = rs > 0 ? d[t] * t / rs : 1; if (t >= mL && c[t] < 0.15) { const a = c[t - 1], b = c[t], cc = c[t + 1]; const de = a - 2 * b + cc; const ft = Math.abs(de) > 1e-12 ? t + (a - cc) / (2 * de) : t; return [{ freq: sr / ft, conf: Math.max(0, 1 - c[t]) }]; } }
  return [];
}
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function peakTrackDetect(fr, sr) {
  const fs = 2048; if (fr.length < fs) return [];
  const w = new Float64Array(fs); for (let i = 0; i < fs; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fs - 1)));
  const re = new Float64Array(fs), im = new Float64Array(fs); for (let i = 0; i < fs; i++) re[i] = fr[i] * w[i]; fft(re, im, fs);
  const half = fs >> 1, mag = new Float64Array(half); for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  const pk = []; for (let i = 2; i < half - 2; i++) { if (mag[i] > mag[i - 1] && mag[i] > mag[i - 2] && mag[i] > mag[i + 1] && mag[i] > mag[i + 2]) { const a = mag[i - 1], b = mag[i], g = mag[i + 1], de = a - 2 * b + g; let fi = i; if (Math.abs(de) > 1e-12) fi = i + (a - g) / (2 * de); const f = fi * sr / fs; if (f > 30 && f < 8000) pk.push({ idx: fi, freq: f, amp: mag[i] }); } }
  if (!pk.length) return []; pk.sort((a, b) => b.amp - a.amp); const maxA = pk[0].amp;
  const strong = pk.filter(p => p.amp > maxA * 0.05); const ca = [];
  for (const p of strong) { let hs = 0; for (let h = 2; h <= 8; h++) { const hf = p.freq * h; const m = pk.find(pp => Math.abs(pp.freq - hf) / hf < 0.06 && pp.amp > p.amp * 0.03); if (m) hs += m.amp / maxA; } let sh = 0; for (let h = 2; h <= 6; h++) { const sf = p.freq / h; const m = pk.find(pp => Math.abs(pp.freq - sf) / sf < 0.06 && pp.amp > p.amp * 0.15); if (m) sh++; } ca.push({ freq: p.freq, conf: Math.min(1, (hs + sh * 0.5) / 3) }); }
  ca.sort((a, b) => b.conf - a.conf); const r = [];
  for (const c of ca) { const dup = r.some(rr => { const ratio = c.freq > rr.freq ? c.freq / rr.freq : rr.freq / c.freq; return Math.abs(ratio - Math.round(ratio)) < 0.05; }); if (!dup && c.conf > 0.15) r.push(c); if (r.length >= 3) break; } return r;
}
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }

// --- 密集比特流 ---
class BW { constructor() { this.b = []; this.a = 0; this.n = 0; }
  w(v, bits) { this.a = (this.a << bits) | (v & ((1 << bits) - 1)); this.n += bits; while (this.n >= 8) { this.n -= 8; this.b.push((this.a >> this.n) & 0xFF); this.a &= (1 << this.n) - 1; } }
  f() { if (this.n > 0) this.b.push((this.a << (8 - this.n)) & 0xFF); return Buffer.from(this.b); }
}

// ===== 主流程 =====
function readWav(path) {
  const buf = fs.readFileSync(path); let off = 12, dataOff, frames;
  while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; frames = sz / 2; break; } off += 8 + sz; }
  const m = new Float64Array(frames); for (let i = 0; i < frames; i++) m[i] = buf.readInt16LE(dataOff + i * 2) / 32768; return m;
}
function writeWav(path, s) {
  const n = s.length; const d = Buffer.alloc(n * 2); for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32768))), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n * 2, 40); fs.writeFileSync(path, Buffer.concat([h, d]));
}

// ===== 主入口 =====
console.log('='.repeat(60));
console.log('整合实验一+二：LPC+MDCT波形 + Fusion扒谱');
console.log('='.repeat(60));

const wav = readWav('tts_speech.wav');
const stride = N, total = wav.length, nf = Math.ceil((total - 2 * N) / stride) + 1;
const bits = [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

console.log(`\n输入: ${(total/SR).toFixed(1)}s @48kHz = ${(total*2/1024).toFixed(0)}KB`);
console.log(`帧: ${nf}×${N}样点 (${(N*1000/SR).toFixed(1)}ms)`);

const t0 = Date.now();
let pY = null, recon = [];
const bw = new BW();
const scoreEvents = [];

// 段A头: 位分配
for (let b = 0; b < BANDS; b++) bw.w(bits[b], 3);

// 段B在最后写
const scoreData = [];

for (let fi = 0; fi < nf; fi++) {
  const st = fi * stride;
  const fr = new Float64Array(2 * N);
  for (let i = 0; i < 2 * N; i++) fr[i] = (st + i) < total ? wav[st + i] : 0;

  // 段A: LPC + MDCT
  const a = lpc(fr);
  if (fi % 8 === 0) for (let i = 1; i <= ORDER; i++) bw.w(Math.round((a[i] + 1) * 127) & 0xFF, 8);
  let X = mdct(fr);
  const Xq = new Float64Array(N);
  for (let b = 0; b < BANDS; b++) {
    const bi = bits[b]; if (bi === 0) continue;
    const scale = 1 << (bi - 1);
    const stb = Math.round(b * N / BANDS), enb = Math.round((b + 1) * N / BANDS);
    let mv = 0; for (let k = stb; k < enb; k++) if (Math.abs(X[k]) > mv) mv = Math.abs(X[k]);
    const mvs = Math.min(65535, Math.round(mv * 32768));
    bw.w((mvs >> 8) & 0xFF, 8); bw.w(mvs & 0xFF, 8);
    if (mv < 1e-10) { for (let k = stb; k < enb; k++) bw.w(0, bi); continue; }
    for (let k = stb; k < enb; k++) { const q = Math.round(X[k] * scale / mv); bw.w(Math.max(0, Math.min((1 << bi) - 1, q + scale)), bi); Xq[k] = q * mv / scale; }
  }

  // 段B: 扒谱 (每 FUSION_INTERVAL 帧跑一次)
  if (fi % FUSION_INTERVAL === 0) {
    const d2048 = new Float64Array(2048);
    for (let i = 0; i < 2048 && st + i < total; i++) d2048[i] = wav[st + i];
    const y = yinDetect(d2048, SR);
    const pt = peakTrackDetect(d2048, SR);
    let f = null;
    if (y.length && pt.length) {
      if (y[0].conf > 0.5) f = y[0];
      else {
        const lo = Math.min(y[0].freq, pt[0].freq), hi = Math.max(y[0].freq, pt[0].freq);
        const r = hi / lo, ro = Math.round(r);
        if (Math.abs(r - ro) < 0.05 || pt[0].freq / y[0].freq >= 2) f = { freq: y[0].freq, conf: (y[0].conf + pt[0].conf) / 2 };
        else f = y[0].conf >= pt[0].conf ? y[0] : pt[0];
      }
    } else if (y.length) f = y[0];
    else if (pt.length) f = pt[0];

    if (f && f.freq > 20 && f.conf > 0.2) {
      const midi = f2m(f.freq);
      const note = Math.round(midi);
      const cent = Math.round((midi - note) * 100);
      // 写入: MIDI(7) + Cent(5) + Conf(4) + Voiced(1) + Onset(3) = 20bit
      bw.w(Math.max(0, Math.min(127, note)), 7);
      bw.w(Math.max(-16, Math.min(15, cent)) + 16, 5); // cent偏移到0-31
      bw.w(Math.min(15, Math.round(f.conf * 15)), 4);
      bw.w(1, 1); // voiced
      bw.w(2, 3); // onset=持续
      const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
      scoreEvents.push({ time: (st / SR).toFixed(2), freq: f.freq.toFixed(1), note: names[note % 12] + Math.floor(note / 12 - 1), conf: f.conf.toFixed(2) });
    } else {
      bw.w(0, 7); bw.w(0, 5); bw.w(0, 4); bw.w(0, 1); bw.w(0, 3); // silence
    }
  }

  const y = imdct(Xq);
  for (let i = 0; i < N; i++) recon.push((pY ? pY[N + i] : 0) + y[i]);
  pY = y;
}

const epcData = bw.f();
const pl = epcData.length;
const frame = Buffer.alloc(6 + pl + 2);
let off = 0;
frame[off++] = 0xBB; frame[off++] = 0x01; frame[off++] = 0xCC;
frame[off++] = (pl >> 8) & 0xFF; frame[off++] = pl & 0xFF;
epcData.copy(frame, off); off += pl;
let cs = 0; for (let i = 1; i < off; i++) cs ^= frame[i];
frame[off++] = cs; frame[off++] = 0x7E;

const reconBuf = new Float64Array(recon);
writeWav('exp1_score.wav', reconBuf);
fs.writeFileSync('exp1_score.epc', frame.slice(0, off));

// SNR
const nm = Math.min(wav.length, reconBuf.length); let e = 0, oe = 0;
for (let i = N; i < nm - N; i++) { const d = wav[i] - reconBuf[i]; e += d * d; oe += wav[i] * wav[i]; }
const snr = e > 1e-20 ? (10 * Math.log10(oe / e)).toFixed(1) + 'dB' : '∞dB';

console.log(`\n--- 结果 ---`);
console.log(`EPC: ${(frame.length / 1024).toFixed(1)}KB (波形段 + 扒谱段)`);
console.log(`WAV: exp1_score.wav (${(reconBuf.length * 2 / 1024).toFixed(0)}KB)`);
console.log(`SNR: ${snr}`);
console.log(`扒谱事件: ${scoreEvents.length}条 (每${FUSION_INTERVAL * N / SR * 1000}ms)`);

// 输出音高时间轴
console.log(`\n--- 音高时间轴 (前5秒) ---`);
console.log(`Time(s)\tFreq(Hz)\tNote\tConf`);
for (const e of scoreEvents) {
  if (parseFloat(e.time) > 5) break;
  console.log(`${e.time}\t${e.freq}\t${e.note}\t${e.conf}`);
}
