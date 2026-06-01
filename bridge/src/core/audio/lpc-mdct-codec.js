// LPC + MDCT 编解码器（替代NeuralAudioCodec）
// 48kHz, N=96, 20阶LPC, 16带固定位分配
// 基于实验一已验证的算法
import logger from '../monitoring/logger.js';

const SR = 48000, N = 96, ORDER = 20, BANDS = 16;

// MDCT 预计算表
const WIN = new Float64Array(2 * N);
const TAB = new Float64Array(N * 2 * N);
const ITAB = new Float64Array(2 * N * N);
let _tablesReady = false;
const _defaultBits = [4, 3, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // 7带
function initTables() {
  if (_tablesReady) return;
  for (let i = 0; i < 2 * N; i++) WIN[i] = Math.sin(Math.PI * (i + 0.5) / (2 * N));
  for (let k = 0; k < N; k++) for (let n = 0; n < 2 * N; n++) TAB[k * 2 * N + n] = Math.cos(Math.PI / N * (n + 0.5 + N / 2) * (k + 0.5));
  for (let n = 0; n < 2 * N; n++) for (let k = 0; k < N; k++) ITAB[n * N + k] = Math.cos(Math.PI / N * (n + 0.5 + N / 2) * (k + 0.5));
  _tablesReady = true;
}
function mdct(x) { const X = new Float64Array(N); for (let k = 0; k < N; k++) { let s = 0; const r = k * 2 * N; for (let n = 0; n < 2 * N; n++) s += x[n] * WIN[n] * TAB[r + n]; X[k] = s; } return X; }
function imdct(X) { const y = new Float64Array(2 * N); for (let n = 0; n < 2 * N; n++) { let s = 0; const r = n * N; for (let k = 0; k < N; k++) s += X[k] * ITAB[r + k]; y[n] = s * (2 / N) * WIN[n]; } return y; }

// LPC
function lpc(sig) {
  const r = new Float64Array(ORDER + 1);
  for (let i = 0; i <= ORDER; i++) { let s = 0; for (let j = 0; j < sig.length - i; j++) s += sig[j] * sig[j + i]; r[i] = s; }
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

// 密集比特流（与run_experiment1.mjs一致）
class BW {
  constructor() { this.b = []; this.a = 0; this.n = 0; }
  w(v, bits) {
    this.a = (this.a << bits) | (v & ((1 << bits) - 1)); this.n += bits;
    while (this.n >= 8) { this.n -= 8; this.b.push((this.a >> this.n) & 0xFF); this.a &= (1 << this.n) - 1; }
  }
  f() { if (this.n > 0) this.b.push((this.a << (8 - this.n)) & 0xFF); return Buffer.from(this.b); }
}

// ===== LpcMdctCodec =====
class LpcMdctCodec {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || SR;
    if (this.sampleRate !== SR) throw new Error(`LpcMdctCodec only supports ${SR}Hz`);
    this.isReady = false;
    this.stats = { framesEncoded: 0, framesDecoded: 0, totalInputBytes: 0, totalOutputBytes: 0, encodeTime: 0, decodeTime: 0 };
    this._bits = null;
    this._prevY = null;
  }

  async initialize() {
    initTables();
    this.isReady = true;
    logger.info('[LpcMdctCodec] Ready (48kHz N=96)');
  }

  async encode(pcmData) {
    if (!this.isReady) throw new Error('Codec not initialized');
    const startTime = Date.now();
    const totalSamples = Math.floor(pcmData.length / 2);
    const samples = new Float64Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) samples[i] = pcmData.readInt16LE(i * 2) / 32768;

    if (!this._bits) {
      // 能量扫描：前500帧 → 动态位分配
      const maxScan = Math.min(500, Math.ceil((totalSamples - 2 * N) / N) + 1);
      if (maxScan > 10) {
        const bandEnergy = new Float64Array(BANDS);
        for (let fi = 0; fi < maxScan; fi++) {
          const st = fi * N; const fr = new Float64Array(2 * N);
          for (let i = 0; i < 2 * N; i++) fr[i] = (st + i) < totalSamples ? samples[st + i] : 0;
          const X = mdct(fr);
          for (let b = 0; b < BANDS; b++) { let e = 0; for (let k = Math.round(b * N / BANDS); k < Math.round((b + 1) * N / BANDS); k++) e += X[k] * X[k]; bandEnergy[b] += e; }
        }
        for (let b = 0; b < BANDS; b++) bandEnergy[b] /= maxScan;
        const isolated = new Set();
        for (let b = 1; b < BANDS - 1; b++) { const avgNB = (bandEnergy[b - 1] + bandEnergy[b + 1]) / 2; if (avgNB > 1 && bandEnergy[b] > avgNB * 1.8) isolated.add(b); }
        if (bandEnergy[0] > bandEnergy[1] * 1.5) isolated.add(0);
        if (bandEnergy[BANDS - 1] > bandEnergy[BANDS - 2] * 1.5) isolated.add(BANDS - 1);
        this._bits = new Uint8Array(BANDS);
        const totalE = bandEnergy.reduce((s, v) => s + v, 0);
        for (let b = 0; b < BANDS; b++) {
          const ratio = bandEnergy[b] / Math.max(totalE, 1e-10) * BANDS;
          if (ratio < 0.005) { this._bits[b] = 0; continue; }
          let bi = Math.max(1, Math.min(7, Math.round(ratio * 6)));
          if (isolated.has(b)) bi = Math.max(bi, 3);
          this._bits[b] = bi;
        }
      } else {
        this._bits = [4, 3, 2, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      }
    }

    // Fusion扒谱：每帧检测F0
    const hopF0 = Math.round(N * 2); // 每2个MDCT帧检测一次
    const f0buf = new Float64Array(Math.ceil(totalSamples / hopF0) + 1);
    const f0conf = new Float64Array(f0buf.length);
    for (let fi = 0; fi < f0buf.length; fi++) {
      const st = fi * hopF0, fs = 2048;
      const fr = new Float64Array(fs);
      for (let i = 0; i < fs; i++) fr[i] = (st + i) < totalSamples ? samples[st + i] : 0;
      const r = _fusionF0(fr);
      if (r) { f0buf[fi] = r.freq; f0conf[fi] = r.conf; } else { f0buf[fi] = 0; f0conf[fi] = 0; }
    }

    const bw = new BW();
    const stride = N;
    const nf = Math.ceil((totalSamples - 2 * N) / stride) + 1;

    for (let b = 0; b < BANDS; b++) bw.w(this._bits[b], 3);

    for (let fi = 0; fi < nf; fi++) {
      const st = fi * stride; const fr = new Float64Array(2 * N);
      for (let i = 0; i < 2 * N; i++) fr[i] = (st + i) < totalSamples ? samples[st + i] : 0;

      let X = mdct(fr);
      for (let b = 0; b < BANDS; b++) {
        const bi = this._bits[b]; if (bi === 0) continue;
        const scale = 1 << (bi - 1);
        const stb = Math.round(b * N / BANDS), enb = Math.round((b + 1) * N / BANDS);
        let mv = 0; for (let k = stb; k < enb; k++) if (Math.abs(X[k]) > mv) mv = Math.abs(X[k]);
        const mvIdx = Math.max(0, Math.min(255, Math.round(Math.log2(Math.max(mv, 1e-10)) * 16 + 128)));
        bw.w(mvIdx, 8);
        if (mv < 1e-10) { for (let k = stb; k < enb; k++) bw.w(0, bi); continue; }
        for (let k = stb; k < enb; k++) { const q = Math.round(X[k] * scale / mv); bw.w(Math.max(0, Math.min((1 << bi) - 1, q + scale)), bi); }
      }
      if (fi % 4 === 0) { bw.w(0, 7); bw.w(0, 5); bw.w(0, 4); bw.w(0, 1); bw.w(0, 3); }
    }

    const epcData = bw.f();
    const pl = epcData.length;
    const frame = Buffer.alloc(7 + pl + 2);
    let off = 0;
    frame[off++] = 0xBB; frame[off++] = 0x01; frame[off++] = 0xCC;
    frame[off++] = (pl >> 16) & 0xFF; frame[off++] = (pl >> 8) & 0xFF; frame[off++] = pl & 0xFF;
    epcData.copy(frame, off); off += pl;
    let cs = 0; for (let i = 1; i < off; i++) cs ^= frame[i];
    frame[off++] = cs; frame[off++] = 0x7E;

    this.stats.framesEncoded += nf;
    this.stats.totalInputBytes += pcmData.length;
    this.stats.totalOutputBytes += frame.length;
    this.stats.encodeTime += Date.now() - startTime;

    return { data: frame.slice(0, off), bitrate: ((frame.length / pcmData.length) * 8 * 1000).toFixed(0), encodeTime: Date.now() - startTime, frameCount: nf, score: this._scoreBuffer || [] };
  }

  async decode(encodedData) {
    if (!this.isReady) throw new Error('Codec not initialized');
    const startTime = Date.now();
    if (encodedData[0] !== 0xBB || encodedData[1] !== 0x01 || encodedData[2] !== 0xCC) throw new Error('Invalid EPC');
    const pl = (encodedData[3] << 16) | (encodedData[4] << 8) | encodedData[5];
    const payload = Buffer.from(encodedData.slice(6, 6 + pl));

    let readPos = 0, readAcc = 0, readBits = 0;
    const read = (bits) => {
      while (readBits < bits) { readAcc = (readAcc << 8) | (payload[readPos++] || 0); readBits += 8; }
      readBits -= bits; const v = (readAcc >> readBits) & ((1 << bits) - 1); readAcc &= (1 << readBits) - 1;
      return v;
    };

    const bits = [];
    for (let b = 0; b < BANDS; b++) bits.push(read(3));

    const stride = N;
    let prevY = null;
    const outputChunks = [];
    let frameIdx = 0;
    const score = [];

    while (readPos < payload.length) {
      const Xq = new Float64Array(N);
      for (let b = 0; b < BANDS; b++) {
        const bi = bits[b]; if (bi === 0) continue;
        const scale = 1 << (bi - 1);
        const mvIdx = read(8);
        const mv = Math.pow(2, (mvIdx - 128) / 16);
        const stb = Math.round(b * N / BANDS), enb = Math.round((b + 1) * N / BANDS);
        for (let k = stb; k < enb; k++) {
          const u = read(bi);
          Xq[k] = (u - (1 << (bi - 1))) * mv / (1 << (bi - 1));
        }
      }

      // 扒谱段：每4帧读一次F0 (20bit)
      if (frameIdx % 4 === 0) {
        const midi = read(7);
        const cent = read(5) - 16;
        const conf = read(4) / 15;
        const voiced = read(1);
        const onset = read(3);
        if (midi > 0 && voiced) {
          const freq = 440 * Math.pow(2, (midi + cent / 100 - 69) / 12);
          score.push({ midi, cent, freq: Math.round(freq * 10) / 10, conf, onset     });
        }
      }

      const y = imdct(Xq);
      const out = new Float64Array(N);
      for (let i = 0; i < N; i++) out[i] = (prevY ? prevY[N + i] : 0) + y[i];
      const buf = Buffer.alloc(N * 2);
      for (let i = 0; i < N; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(out[i] * 32768))), i * 2);
      outputChunks.push(buf);
      prevY = y;
      frameIdx++;
    }

    const output = Buffer.concat(outputChunks);
    this.stats.framesDecoded += frameIdx;
    this.stats.decodeTime += Date.now() - startTime;
    return { pcm: output, decodeTime: Date.now() - startTime, score };
  }
}


// ===== Fusion扒谱 (YIN + PeakTrack) =====
function _yinF0(samples) {
  const sr = SR, fs = 2048, mL = Math.ceil(sr / 2000), ML = Math.floor(sr / 40);
  if (samples.length < fs) return null;
  const d = new Float64Array(ML + 1); for (let t = 0; t <= ML; t++) { let s = 0; for (let i = 0; i < fs - t; i++) { const dd = samples[i] - samples[i + t]; s += dd * dd; } d[t] = s; }
  const c = new Float64Array(ML + 1); c[0] = 1; let rs = 0;
  for (let t = 1; t <= ML; t++) { rs += d[t]; c[t] = rs > 0 ? d[t] * t / rs : 1; if (t >= mL && c[t] < 0.15) { const a = c[t - 1], b = c[t], cc = c[t + 1]; const de = a - 2 * b + cc; const ft = Math.abs(de) > 1e-12 ? t + (a - cc) / (2 * de) : t; return { freq: sr / ft, conf: Math.max(0, 1 - c[t]) }; } }
  return null;
}
function _peakTrackF0(samples) {
  const sr = SR, fs = 2048; if (samples.length < fs) return null;
  const w = new Float64Array(fs); for (let i = 0; i < fs; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fs - 1)));
  const re = new Float64Array(fs), im = new Float64Array(fs); for (let i = 0; i < fs; i++) re[i] = samples[i] * w[i]; _fft(re, im, fs);
  const half = fs >> 1, mag = new Float64Array(half); for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  const pk = []; for (let i = 2; i < half - 2; i++) { if (mag[i] > mag[i - 1] && mag[i] > mag[i - 2] && mag[i] > mag[i + 1] && mag[i] > mag[i + 2]) { const a = mag[i - 1], b = mag[i], g = mag[i + 1], de = a - 2 * b + g; let fi = i; if (Math.abs(de) > 1e-12) fi = i + (a - g) / (2 * de); const f = fi * sr / fs; if (f > 30 && f < 8000) pk.push({ freq: f, amp: mag[i] }); } }
  if (!pk.length) return null; pk.sort((a, b) => b.amp - a.amp); const maxA = pk[0].amp;
  const strong = pk.filter(p => p.amp > maxA * 0.05); const ca = [];
  for (const p of strong) { let hs = 0; for (let h = 2; h <= 8; h++) { const hf = p.freq * h; const m = pk.find(pp => Math.abs(pp.freq - hf) / hf < 0.06 && pp.amp > p.amp * 0.03); if (m) hs += m.amp / maxA; } let sh = 0; for (let h = 2; h <= 6; h++) { const sf = p.freq / h; const m = pk.find(pp => Math.abs(pp.freq - sf) / sf < 0.06 && pp.amp > p.amp * 0.15); if (m) sh++; } ca.push({ freq: p.freq, conf: Math.min(1, (hs + sh * 0.5) / 3) }); }
  ca.sort((a, b) => b.conf - a.conf); return ca.length > 0 ? ca[0] : null;
}
function _fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function _fusionF0(samples) {
  const y = _yinF0(samples), pt = _peakTrackF0(samples);
  if (!y) return pt; if (!pt) return y;
  if (y.conf > 0.5) return y;
  const lo = Math.min(y.freq, pt.freq), hi = Math.max(y.freq, pt.freq);
  const ratio = hi / lo, ro = Math.round(ratio);
  if (Math.abs(ratio - ro) < 0.05 || pt.freq / y.freq >= 2) return { freq: y.freq, conf: (y.conf + pt.conf) / 2 };
  return y.conf >= pt.conf ? y : pt;
}

export default LpcMdctCodec;
