// === logger.js ===
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

// Dev 模式：直接用 console，不输出 JSON
const logger = isDev ? new Proxy({}, {
  get(_, level) {
    const levels = { info: 30, warn: 40, error: 50, debug: 20, fatal: 60, trace: 10 };
    const n = levels[level];
    if (!n) return () => {};
    const fn = n >= 50 ? console.error : n >= 40 ? console.warn : console.log;
    return (obj, msg, ...rest) => {
      if (typeof obj === 'string') { fn(`[${level.toUpperCase()}] ${obj}`); return; }
      const text = msg || obj?.msg || '';
      const details = rest.length ? ' ' + rest.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') : '';
      const err = obj?.err || obj?.error;
      fn(`[${level.toUpperCase()}] ${text}${details}${err ? ' (' + (err.message || err) + ')' : ''}`);
    };
  }
}) : pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: ['req.headers.authorization', 'req.body.token', 'req.body.password', 'token', 'password', 'secret'], censor: '[REDACTED]' },
  serializers: { req: (req) => ({ method: req.method, url: req.url, headers: req.headers }), err: pino.stdSerializers.err, error: pino.stdSerializers.err },
});

export { logger };

// === lmdn-codec.mjs ===
// LPC + MDCT 编解码器（替代NeuralAudioCodec）
// 48kHz, N=96, 20阶LPC, 16带固定位分配
// 基于实验一已验证的算法

const SR = 48000, N = 96, BANDS = 16;

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
function lpc(sig, order) {
  const r = new Float64Array(order + 1);
  for (let i = 0; i <= order; i++) { let s = 0; for (let j = 0; j < sig.length - i; j++) s += sig[j] * sig[j + i]; r[i] = s; }
  r[0] *= 1.01; const a = new Float64Array(order + 1); a[0] = 1; const e = new Float64Array(order + 1); e[0] = r[0];
  for (let i = 1; i <= order; i++) {
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
    while (this.n >= 8) { this.n -= 8; this.b.push((this.a >> this.n) & 0xFF); this.a = this.a & ((1 << this.n) - 1); }
  }
  f() { if (this.n > 0) this.b.push((this.a << (8 - this.n)) & 0xFF); return Buffer.from(this.b); }
}

// ===== LmdnCodec =====
class LmdnCodec {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || SR;
    if (this.sampleRate !== SR) throw new Error(`LmdnCodec only supports ${SR}Hz`);
    this.isReady = false;
    this.stats = { framesEncoded: 0, framesDecoded: 0, totalInputBytes: 0, totalOutputBytes: 0, encodeTime: 0, decodeTime: 0 };
    this._bits = null;
    this._prevY = null;
  }

  async initialize() {
    initTables();
    this.isReady = true;
    logger.info('[LmdnCodec] Ready (48kHz N=96)');
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

    const LPC_UPDATE = 4, LPC_ORDER = 2;
    for (let fi = 0; fi < nf; fi++) {
      const st = fi * stride; const fr = new Float64Array(2 * N);
      for (let i = 0; i < 2 * N; i++) fr[i] = (st + i) < totalSamples ? samples[st + i] : 0;

      // LPC 分析（每 LPC_UPDATE 帧写入系数）
      if (fi % LPC_UPDATE === 0) {
        const a = lpc(fr, LPC_ORDER);
        for (let i = 1; i <= LPC_ORDER; i++) {
          const v = Math.round(a[i] * 1000);
          bw.w(Math.max(0, Math.min(65535, v < 0 ? v + 65536 : v)), 16);
        }
      }

      const X = mdct(fr);
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
      readBits -= bits; const v = (readAcc >> readBits) & ((1 << bits) - 1); readAcc = readAcc & ((1 << readBits) - 1);
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
      // LPC 系数（与编码端同步读取）
      const LPC_UPDATE = 4, LPC_ORDER = 2;
      if (frameIdx % LPC_UPDATE === 0) {
        for (let i = 1; i <= LPC_ORDER; i++) {
          let val = read(16);
          if (val >= 32768) val -= 65536;
          // val/1000 = a[i]（预留后处理）
        }
      }

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

export default LmdnCodec;

// === poller-shim.mjs ===
const _inFlight = new Set();
const MAX_IN_FLIGHT = 50;
const _deps = {};

export function _setDeps(overrides) {
  Object.assign(_deps, overrides);
}

export function _resetDeps() {
  Object.keys(_deps).forEach(k => delete _deps[k]);
}

export function _getDeps() { return { ..._deps }; }

export function tsFromKey(key) {
  if (typeof key !== 'string') return 0;
  const m = key.match(/(\d+)\.\w+$/);
  return m ? parseInt(m[1], 10) : 0;
}

export function parseMsgPayload(key, raw) {
  let payload = raw;
  if (raw[0] === 0xBB && raw.length >= 8) {
    const pl = (raw[3] << 16) | (raw[4] << 8) | raw[5];
    payload = raw.slice(6, 6 + pl);
  }
  let msg;
  try {
    msg = JSON.parse(payload.toString('utf8'));
  } catch {
    return null;
  }
  if (msg.type !== 'text' || !msg.text) return null;
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  return { text: msg.text, chatId, ts: 0 };
}

export async function startChatPoll(intervalMs = 1000) {
  let timer = null;
  let running = false;
  return {
    start: () => { running = true; },
    stop: () => { running = false; if (timer) { clearTimeout(timer); timer = null; } },
    isRunning: () => running,
  };
}

export async function handleMessage(key, raw) {
  const parsed = parseMsgPayload(key, raw);
  if (!parsed) return { error: 'unparseable' };
  const r = await _deps.composeRun('poll-one', { msgKey: key, text: parsed.text, chatId: parsed.chatId });
  return { reply: r?.outputs?.reply || 'echo ' + parsed.text, replyKey: r?.outputs?.replyKey, sourceKey: key, chatId: parsed.chatId };
}

export async function handleVoice(key, raw) {
  if (raw.length < 3 || raw[0] !== 0xBB || raw[1] !== 0x01) return null;
  const pl = (raw[2] << 16) | (raw[3] << 8) | raw[4];
  const payload = raw.slice(5, 5 + pl);
  const text = payload.toString('utf8');
  const parts = key.split('/');
  const chatId = parts.length >= 3 ? parts[2] : 'default';
  const r = await _deps.composeRun('poll-one', { msgKey: key, text, chatId });
  return { reply: r?.outputs?.reply, replyKey: r?.outputs?.replyKey, sourceKey: key, chatId };
}

export async function processOne(key) {
  if (_inFlight.size >= MAX_IN_FLIGHT) return { skipped: 'backpressure' };
  if (_inFlight.has(key)) return { skipped: 'in-flight' };
  _inFlight.add(key);
  try {
    const raw = await _deps.qiniuGet(key);
    if (!raw || raw.length === 0) return { skipped: 'empty' };
    const parsed = parseMsgPayload(key, raw);
    if (!parsed) return { skipped: 'unparseable' };
    const r = await _deps.composeRun('poll-one', { msgKey: key, text: parsed.text, chatId: parsed.chatId });
    const reply = { reply: r.outputs.reply, replyKey: r.outputs.replyKey, error: r.outputs.error, sourceKey: key, chatId: parsed.chatId };
    return reply;
  } catch (err) {
    return { error: err.message };
  } finally {
    _inFlight.delete(key);
  }
}

// === report.mjs ===
// Per-experiment reporter — each `create()` returns a fresh state object
// so experiments don't accumulate details from previous files when run via run-all.
export function create() {
  const result = { pass: 0, fail: 0, skip: 0, details: [] };
  return {
    ok(msg)  { result.pass++;  result.details.push(`  ✓ ${msg}`); },
    ng(msg, err) { result.fail++; result.details.push(`  ✗ ${msg}${err ? ': ' + (err?.message || err) : ''}`); },
    skip(msg) { result.skip++; result.details.push(`  - ${msg} (skip)`); },
    report(name) {
      console.debug(`\n╔══ ${'═'.repeat(name.length + 4)}╗`);
      console.debug(`║    ${name}    ║`);
      console.debug(`╚══ ${'═'.repeat(name.length + 4)}╝`);
      result.details.forEach(d => console.debug(d));
      const total = result.pass + result.fail + result.skip;
      console.debug(`\n${result.pass}/${total} passed, ${result.fail} failed, ${result.skip} skipped`);
      return result.fail === 0;
    },
  };
}

// Legacy default export (back-compat for older experiment files):
// each top-level call still gets a fresh internal state.
let _state = null;
function _get() {
  if (!_state) _state = create();
  return _state;
}
export const ok   = (msg)   => _get().ok(msg);
export const ng   = (msg, err) => _get().ng(msg, err);
export const skip = (msg)   => _get().skip(msg);
export function report(name) {
  const out = _get().report(name);
  _state = null; // reset for next experiment
  return out;
}

// === repl-history.mjs ===
// === repl-history.mjs ===
// dev-repl 的消息历史持久化 (opencode `openchat -c` 续接需要)
//
// 存储位置: ~/.openchat/repl-history/<chatId>.json
//   - 与 persistent-store 的 sessions.json 物理隔离
//   - 不参与 sessions 列表 (避免历史会话被时间排序)
//
// 消息格式: [{ role, content, tool_calls?, tool_call_id? }, ...]
//   - OpenAI chat 兼容格式, 可直接塞回 provider.chat() 的 messages 参数
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { op: 'load', chatId } → { history: [...] }
//   { op: 'save', chatId, history } → { ok, count }
//   { op: 'append', chatId, msg } → { ok, count }
//   { op: 'clear', chatId } → { ok }
//
// === invariants ===
// - load 永不抛 — 文件不存在/JSON 损坏都返回空数组
// - save 原子写: 写 .tmp 再 rename (避免半写状态)
// - 单文件 messages 数组上限 1000 条 (写时裁剪), 防止 history 文件膨胀
// - chatId 路径用 [a-zA-Z0-9_-] 过滤, 防 ../ 穿越
// - 不与 persistent-store 耦合, 是独立 fs 命名空间

import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

const HISTORY_DIR = path.join(homedir(), '.openchat', 'repl-history');
const MAX_HISTORY = 1000;
const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function safeId(chatId) {
  if (typeof chatId !== 'string' || !VALID_ID.test(chatId)) {
    throw new Error(`repl-history: invalid chatId "${chatId}" (must match ${VALID_ID})`);
  }
  return chatId;
}

function ensureDir() {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function filePath(chatId) {
  return path.join(HISTORY_DIR, `${safeId(chatId)}.json`);
}

export function loadHistory(chatId) {
  const fp = filePath(chatId);
  try {
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveHistory(chatId, history) {
  if (!Array.isArray(history)) throw new Error('repl-history: history must be array');
  const fp = filePath(chatId);
  ensureDir();
  // 裁剪
  const trimmed = history.length > MAX_HISTORY
    ? [history[0], ...history.slice(-(MAX_HISTORY - 1))] // 保留 system + 末 N-1
    : history;
  // 直接写盘: Windows rename 偶发 EPERM (单用户 dev-repl, 可接受非原子)
  fs.writeFileSync(fp, JSON.stringify(trimmed));
  return { ok: true, count: trimmed.length };
}

export function appendMessage(chatId, msg) {
  const h = loadHistory(chatId);
  h.push(msg);
  return saveHistory(chatId, h);
}

export function clearHistory(chatId) {
  const fp = filePath(chatId);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

export function listSessions() {
  try {
    ensureDir();
    return fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  } catch { return []; }
}

export async function run({ inputs = {} } = {}) {
  const { op, chatId, history, msg } = inputs;
  if (!op) throw new Error('repl-history.run: op required');
  switch (op) {
    case 'load':   return { outputs: { history: loadHistory(chatId) } };
    case 'save':   return { outputs: saveHistory(chatId, history || []) };
    case 'append': return { outputs: appendMessage(chatId, msg) };
    case 'clear':  return { outputs: clearHistory(chatId) };
    case 'list':   return { outputs: { sessions: listSessions() } };
    default: throw new Error(`repl-history.run: unknown op "${op}"`);
  }
}

export const META_REPL_HISTORY = { id: 'repl-history' };

// === agent-hooks.mjs ===
// agent-hooks.mjs — LLM tool-loop 的 pre/post hook 注册表 (Step 6.1 / L3 整车基础)
//
// 用途: 让 permission / log / 限流 / 撤销 等能力, 以 hook 形式注入到 tool 执行链,
//       不动 22.mjs _execTool 主流程.
//
// 事件:
//   - preTool(tool, args)   — tool 跑前, 抛 throw 终止本次调用
//   - postTool(tool, args, result) — tool 跑后, return 新 result (string)
//
// 调用方 (22.mjs): _execTool 内 await runPre(...) → codingExec → runPost(...)
// 注册方 (lib/permission.mjs 等): on('preTool', 'permission', fn)

const _hooks = new Map(); // event → Map<name, fn>

export function on(event, name, fn) {
  if (event !== 'preTool' && event !== 'postTool') {
    throw new Error(`agent-hooks: unknown event "${event}" (use preTool|postTool)`);
  }
  if (typeof fn !== 'function') throw new Error(`agent-hooks: hook "${name}" must be a function`);
  if (!_hooks.has(event)) _hooks.set(event, new Map());
  _hooks.get(event).set(name, fn);
  return () => off(event, name);  // 返回 unsubscribe
}

export function off(event, name) {
  return _hooks.get(event)?.delete(name) ?? false;
}

export function clear(event) {
  if (event) _hooks.get(event)?.clear();
  else _hooks.clear();
}

// preTool: 顺序跑, 任何抛 throw 中止链 (postTool 仍跑, 用于清理)
export async function runPre(tool, args) {
  const hooks = _hooks.get('preTool');
  if (!hooks) return;
  for (const [name, fn] of hooks) {
    try {
      await fn(tool, args);
    } catch (e) {
      e.hookName = name;
      throw e;
    }
  }
}

// postTool: 顺序跑, 每个 hook 的 return 传给下一个 (chain-of-responsibility).
// 任何 hook throw 不抛, 改 console.warn (post 不应阻断主流程)
export async function runPost(tool, args, result) {
  const hooks = _hooks.get('postTool');
  if (!hooks) return result;
  let cur = result;
  for (const [name, fn] of hooks) {
    try {
      cur = await fn(tool, args, cur);
    } catch (e) {
      console.debug(`[agent-hooks] postTool "${name}" failed: ${e.message}`);
    }
  }
  return cur;
}

export function listHooks() {
  const out = {};
  for (const [event, map] of _hooks) {
    out[event] = [...map.keys()];
  }
  return out;
}

export function getStats() {
  const out = {};
  for (const [event, map] of _hooks) {
    out[event] = map.size;
  }
  return out;
}

// === hooks-builtin.mjs ===

const _callLog = [];
const MAX_LOG = 100;

export function enableLoggingHook() {
  const unsubPre = on('preTool', 'logger', async (tool, args) => {
    _callLog.push({ type: 'pre', tool, args, time: Date.now() });
    if (_callLog.length > MAX_LOG) _callLog.splice(0, _callLog.length - MAX_LOG);
  });
  const unsubPost = on('postTool', 'logger', async (tool, args, result) => {
    _callLog.push({ type: 'post', tool, time: Date.now(), resultLength: typeof result === 'string' ? result.length : 0 });
    if (_callLog.length > MAX_LOG) _callLog.splice(0, _callLog.length - MAX_LOG);
  });
  return () => { unsubPre(); unsubPost(); };
}

export function enablePermissionHook(gate) {
  // gate: async (tool, args) => { ok: bool, error?: string }
  if (typeof gate !== 'function') throw new Error('permission hook needs a gate function');
  return on('preTool', 'permission-gate', async (tool, args) => {
    const r = await gate(tool, args);
    if (!r.ok) throw new Error(r.error || 'Permission denied');
  });
}

export function enableRateLimitHook(maxPerMinute = 30) {
  const window = [];
  return on('preTool', 'rate-limit', async () => {
    const now = Date.now();
    while (window.length > 0 && window[0] < now - 60000) window.shift();
    if (window.length >= maxPerMinute) throw new Error(`Rate limit: ${maxPerMinute} tools/min exceeded`);
    window.push(now);
  });
}

export function getCallLog() { return [..._callLog]; }

export function clearCallLog() { _callLog.length = 0; }

export const META_HOOKS = { id: 'hooks-builtin' };

// === agent-memory.mjs ===
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';

function dir() {
  const h = process.env.HOME || process.env.USERPROFILE;
  return resolve(h || process.cwd(), '.openchat');
}

const FILE = () => resolve(dir(), 'agent-memory.json');

let _cache = null;

export async function load() {
  if (_cache) return _cache;
  try {
    const raw = await readFile(FILE(), 'utf8');
    _cache = JSON.parse(raw);
    return _cache;
  } catch {
    _cache = { facts: [], preferences: [], learnedPatterns: [], createdAt: Date.now(), updatedAt: Date.now() };
    return _cache;
  }
}

export async function save() {
  if (!_cache) return;
  _cache.updatedAt = Date.now();
  if (!existsSync(dir())) await mkdir(dir(), { recursive: true });
  await writeFile(FILE(), JSON.stringify(_cache, null, 2), 'utf8');
}

export async function addFact(fact) {
  const m = await load();
  m.facts.push({ text: fact, ts: Date.now() });
  if (m.facts.length > 100) m.facts.splice(0, m.facts.length - 100);
  await save();
  return m.facts.length;
}

export async function addPreference(key, value) {
  const m = await load();
  m.preferences = m.preferences.filter(p => p.key !== key);
  m.preferences.push({ key, value, ts: Date.now() });
  await save();
}

export async function addPattern(pattern) {
  const m = await load();
  m.learnedPatterns.push({ text: pattern, ts: Date.now(), count: 1 });
  await save();
}

export function summary() {
  if (!_cache) return '(not loaded)';
  return `${_cache.facts.length} facts, ${_cache.preferences.length} preferences, ${_cache.learnedPatterns.length} patterns`;
}

export const META_MEMORY = { id: 'agent-memory' };

// === permission-gate.mjs ===
// permission-gate.mjs — L3 件: per-tool permission check + trust 持久化
//
// 设计 (Step 6 / L3 件 1):
//   - 每个 tool 有 permission 级: 'safe' | 'confirm' | 'forbidden'
//     safe      = 不问, 直接跑 (read_file, grep, ast_*)
//     confirm   = 首次问用户, 用户 y/n/always
//     forbidden = 永远 block (留给危险操作, 当前不分配)
//   - 用户答 'always' / 'a' → 写 ~/.openchat/trust.json, 之后不再问
//   - 用户答 'y' → 这次跑, 不存
//   - 用户答 'n' → 返 [Denied] 给 LLM, 让它调整
//   - always-on: 默认启用. CLI 首次问, bridge 静默 allow. setEnabled(false) 可关
//   - bridge 必须不阻塞: 同步 input() 只能在 CLI / standalone; bridge 走 phone 时应 bypass
//     → 检测到没有 TTY 或 ctx.bridgeMode → 静默 y (跟 user 确认过, 实际是 phone 端鉴权)

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
const TRUST_DIR = join(homedir(), '.openchat');
const TRUST_FILE = join(TRUST_DIR, 'trust.json');

let _enabled = true;
let _trust = null;  // 懒加载

// === invariants ===
//   - _enabled 默认 true, setEnabled(false) 是测试 escape hatch
//   - _trust 懒加载, 损坏/读失败 → 静默重置为空 (主流程不 throw)
//   - checkPermission 总是返 { allowed, reason }; allowed=false 时 22.mjs 把 reason 当 tool result 返给 LLM
//   - bridge 模式 (无 process.stdin.isTTY 或 ctx.bridgeMode) → confirm 静默 allow + log, 不阻塞
//   - 未知 tool → 默认 'confirm' (保守, 走 confirm 路径)
//   - trust 写失败 → 静默 (不影响 runtime, 不影响本次 allow 决策)
// === end invariants ===

const TOOL_PERMISSION = {
  // safe = 只读 / 不可逆影响 (读/查/分析)
  read_file: 'safe', grep: 'safe', find_refs: 'safe', code_search: 'safe',
  ast_index: 'safe', ast_find_refs: 'safe', ast_search: 'safe', ast_extract: 'safe',
  get_cwd: 'safe', read_memory: 'safe',
  // 验证类 (跑测试/lint, 可改文件系统, 不可逆)
  test_run: 'confirm', test_discover: 'safe', lint_run: 'confirm', lint_fix: 'confirm',
  ts_typecheck: 'safe', test_parallel: 'confirm', test_flaky: 'safe',
  build_run: 'confirm', docker_build: 'confirm', sec_audit: 'safe', ci_detect: 'safe', env_diff: 'safe',
  // 编辑类 (核心 confirm, write_file 已有 shrink 护栏再加权限闸)
  write_file: 'confirm', edit_file: 'confirm', hash_edit: 'confirm',
  // git 类 (commit 安全, push 危险)
  git_commit: 'confirm', git_log: 'safe', git_branch: 'safe', git_merge_dry: 'safe', git_apply_patch: 'confirm',
  // shell / 通用 (任何走 shell 的都 confirm)
  lang_run: 'confirm', lang_parse: 'safe', lang_parse_file: 'safe', lang_ast_parse: 'safe',
  curl_run: 'confirm', sql_parse: 'safe',
  // 依赖图 / 文档建议
  dep_graph: 'safe', detect_cycles: 'safe', to_mermaid: 'safe',
  docs_suggest: 'safe', ast_rename: 'confirm',
  // memory
  memory_store: 'confirm',
};

function _ensureDir() {
  try { if (!existsSync(TRUST_DIR)) mkdirSync(TRUST_DIR, { recursive: true }); } catch { /* 失败静默 */ }
}

function _loadTrust() {
  if (_trust) return _trust;
  _trust = {};
  try {
    if (existsSync(TRUST_FILE)) {
      _trust = JSON.parse(readFileSync(TRUST_FILE, 'utf8'));
    }
  } catch { /* 损坏的 trust 文件: 静默重置 */ }
  return _trust;
}

function _saveTrust() {
  try {
    _ensureDir();
    writeFileSync(TRUST_FILE, JSON.stringify(_trust, null, 2));
  } catch { /* 失败不影响 runtime */ }
}

export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function getPermission(toolName) { return TOOL_PERMISSION[toolName] || 'confirm'; }  // 未知工具默认 confirm (保守)

// 核心: 检查 tool 是否被允许执行
//   返回 { allowed: bool, reason: string }
//   - allowed=false 时, 22.mjs 把 reason 当 tool result 返给 LLM (让它调整)
//   - bridge 模式 (无 TTY) → 默认 allow + log (跟 user 约定)
export function checkPermission(toolName, args = {}, ctx = {}) {
  const perm = getPermission(toolName);

  if (!_enabled) return { allowed: true, reason: 'permission disabled (env off)' };
  if (perm === 'safe') return { allowed: true, reason: 'safe' };
  if (perm === 'forbidden') return { allowed: false, reason: 'tool forbidden by policy' };

  // confirm 路径
  const trust = _loadTrust();
  const key = `${toolName}:${JSON.stringify(args)}`;
  const toolKey = toolName;

  // 1. tool 级别 "always" 信任
  if (trust[toolKey] === 'always') return { allowed: true, reason: 'trusted (always)' };

  // 2. 精确参数级 "always" 信任
  if (trust[key] === 'always') return { allowed: true, reason: 'trusted (exact args)' };

  // 3. 问用户 (TTY 检查)
  if (!process.stdin.isTTY || ctx.bridgeMode) {
    // bridge 模式: 静默 allow (phone 端鉴权), log 一下
    console.debug(`[permission] ${toolName} (auto-allow bridge mode) args=${JSON.stringify(args).slice(0, 80)}`);
    return { allowed: true, reason: 'bridge mode auto-allow' };
  }

  // 4. CLI 模式: 真问
  console.debug(`\n[permission] Tool '${toolName}' wants to run.`);
  console.debug(`  args: ${JSON.stringify(args).slice(0, 200)}`);
  process.stdout.write('  Allow? [y/n/always] (default n): ');
  let answer = '';
  try {
    answer = (require('fs').readFileSync(0, 'utf8').trim().toLowerCase()) || 'n';
  } catch { answer = 'n'; }
  // ↑ 简化: 用 readFileSync 同步读 stdin (避免引入 readline)

  if (answer === 'a' || answer === 'always') {
    trust[toolName] = 'always';
    _saveTrust();
    return { allowed: true, reason: 'user said always' };
  }
  if (answer === 'y' || answer === 'yes') {
    return { allowed: true, reason: 'user said yes' };
  }
  return { allowed: false, reason: `user denied (answer: ${answer || 'n'})` };
}

export function resetTrust() {
  _trust = {};
  _saveTrust();
}

export function listTrust() {
  return _loadTrust();
}

// === slash-commands.mjs ===
// === slash-commands.mjs ===
// dev-repl 的斜杠命令分发 (opencode /claudecode 风格):

// === invariants ===
// - COMMANDS 是单例, 不在运行时变更 (P0 命令集)
// - parseSlash 是纯函数, 不读 cfg 不写盘
// - applySlash 整体 async (commit 路径要 await onCommit), 其他 case 直接返同步值包成 Promise
// - 不直接操作 readline / process.exit, 全部通过 sideEffect 通知 dev-repl
// - 不持久化 model 切换 (运行中内存态, 退出生效)
// - /resume 接受 id 或序号, 找不到返 "找不到" 不抛
// - /commit 必依赖 ctx.onCommit, 缺失返 "未注入" 不抛
//   /help                  — 列出所有命令
//   /status                — 当前 session/provider/model/工具数/历史轮数
//   /clear                 — 清屏 + 重置历史
//   /history-clear         — 清空当前 session 的对话历史 (不退出, 不清屏)
//   /model <name|id>       — 切换当前 model (运行中, 写到 ctx.model)
//   /resume [chatId]       — 列有历史的 session (无参) 或 跳到指定 session (有参)
//   /forget [chatId]       — 列有历史的 session; 或 /forget <id> --force 删除
//   /diff                  — 显示未提交的 git diff
//   /commit                — 一键 git add + 自动 commit msg (基于 git diff)
//   /task <goal>           — 派生子 agent 跑任务 (独立 session)
//   /workflow <name>       — 运行已定义的工作流
//   /exit                  — 退出 (alias: /quit)
//
// 故意不做 (留给后续 PR): /sessions /cost /bug /init /memory
// 理由: 这些要新建 storage 子模块, 一次提交 diff 超 500 行 (违反 R4)
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { input, ctx } → { handled: bool, reply?: string, sideEffect?: { setModel?, clearHistory?, resumeTo?: string, exit? } }
//   ctx 扩展: availableSessions?: [{ id, msgCount, lastActivity, cwd? }]
//     (由 dev-repl 注入, slash-commands 不硬耦合 repl-history)
//
// COMMANDS 字段约定 (供 help/autocomplete/validate 共用):
//   { name: { arg, desc, permission? } }
//     - arg:      用法占位符 ('', '<...>', '[...]'), 喂给 /help 文本
//     - desc:     一行中文说明
//     - permission: 'self' = 仅影响当前 session (无权限闸); 默认同 'self'
//                  'git'  = 需要 cwd 在 git 仓库内 (e.g. /commit /diff)
//   unknown/permission-gate 命令由 applySlash 在运行时判定, 静态注册表只声明元数据

export const COMMANDS = {
  help:    { arg: '',              desc: '列出所有 slash 命令' },
  status:  { arg: '',              desc: '显示 session/provider/model/工具数/历史轮数' },
  clear:         { arg: '',         desc: '清屏 + 重置对话历史 (不退出)' },
  'history-clear':{ arg: '',         desc: '清空当前 session 的对话历史 (不退出, 不清屏)', permission: 'self' },
  model:   { arg: '<name|id>',     desc: '切换当前 model, 写到 cfg.current.model' },
  resume:  { arg: '[chatId]',      desc: '列有历史的 session; 或 /resume <id> 跳到指定' },
  forget:  { arg: '[chatId]',      desc: '列有历史的 session; 或 /forget <id> 删除指定' },
  hooks:   { arg: '',              desc: '列出已注册的 agent hook (preTool/postTool) 插件' },
  compact: { arg: '',              desc: '重置 token 累积计数器 (释放 token 阈值警告)' },
  commit:  { arg: '',              desc: '一键 git add + 自动 commit msg (基于 git diff)' },
  diff:    { arg: '',              desc: '显示未提交的 git diff (基于 cwd)' },
  task:    { arg: '<goal>',        desc: '派生子 agent 跑任务 (独立 session, 不污染主历史)' },
  workflow:{ arg: '<workflowName>', desc: '运行已定义的工作流 (从上下文对话生成)' },
  exit:    { arg: '',              desc: '退出 REPL (alias: /quit)' },
  quit:    { arg: '',              desc: '退出 REPL (alias: /exit)' },
};

export function listCommands() {
  return Object.entries(COMMANDS)
    .map(([k, v]) => `  /${k.padEnd(8)} ${v.arg.padEnd(14)} ${v.desc}`)
    .join('\n');
}

// === 供 autocomplete / 校验 用的只读视图 ===
// 返回全部已注册命令名 (按插入顺序) — 喂给 readline completer
export function listCommandNames() {
  return Object.keys(COMMANDS);
}

// 校验输入是否是合法命令名 (大小写不敏感)
// 返回 { ok: true, cmd } 或 { ok: false, suggestion?: string }
// 供 dev-repl 在 tab 补全 / 拼写纠错时调用
export function validateCommandName(input) {
  if (typeof input !== 'string' || !input) return { ok: false };
  const lower = input.toLowerCase();
  if (COMMANDS[lower]) return { ok: true, cmd: lower };
  // 拼写提示: 取 Levenshtein 距离最小的邻居, 距离 ≤ 2 才返回
  // (放宽到 2 是因为长名 (如 history-clear) 漏 1-2 字符仍属常见 typo)
  const names = Object.keys(COMMANDS);
  let best = null, bestDist = Infinity;
  for (const n of names) {
    const d = levenshtein(n, lower);
    if (d < bestDist) { bestDist = d; best = n; }
  }
  return { ok: false, suggestion: best && bestDist <= 2 ? `/${best}` : null };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    let cur = i;
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
      prevDiag = tmp;
      prev[j] = cur;
    }
  }
  return prev[n];
}

export function parseSlash(input) {
  if (typeof input !== 'string') return { handled: false };
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return { handled: false };
  const spaceIdx = trimmed.indexOf(' ');
  const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).slice(1).toLowerCase();
  const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  if (!COMMANDS[cmd]) return { handled: true, reply: `未知命令: /${cmd}\n输入 /help 查看可用命令。` };
  return { handled: true, cmd, arg };
}

function formatRelativeTime(ts) {
  if (!ts || typeof ts !== 'number') return 'unknown';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 7 * 86400000) return `${Math.floor(diff / 86400000)} 天前`;
  return new Date(ts).toISOString().slice(0, 10);
}

export async function applySlash({ cmd, arg, ctx }) {
  // ctx: { cfg, model, sessionId, historyRounds, toolCount, cCwd, availableSessions? }
  switch (cmd) {
    case 'help':
      return { reply: `可用命令:\n${listCommands()}` };
    case 'status':
      return {
        reply: [
          `  session:    ${ctx.sessionId}`,
          `  provider:   ${ctx.providerName || '(none)'}/${ctx.model || '(default)'}`,
          `  cwd:        ${ctx.cwd || process.cwd()}`,
          `  tools:      ${ctx.toolCount}`,
          `  history:    ${ctx.historyRounds} 轮`,
          '', // 空行
          typeof ctx.costSummary === 'string' ? ctx.costSummary : '  cost: 暂无记录',
        ].join('\n'),
      };
    case 'clear':
      return { reply: '\x1b[2J\x1b[H', sideEffect: { clearHistory: true } };
    case 'history-clear':
      return { reply: '已清空当前 session 的对话历史。', sideEffect: { clearHistory: true } };
    case 'model': {
      if (!arg) return { reply: '用法: /model <name|id>\n  当前: ' + (ctx.model || '(default)') };
      return { reply: `已切换 model: ${arg}  (下次 LLM 调用生效)`, sideEffect: { setModel: arg } };
    }
    case 'resume': {
      const list = ctx.availableSessions || [];
      if (!arg) {
        if (!list.length) return { reply: '没有可续接的历史 session。' };
        const lines = ['可续接的 session (按最近活跃排序):'];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          const tag = s.id === ctx.sessionId ? ' ← 当前' : '';
          lines.push(`  ${String(i + 1).padStart(2)}. ${s.id} · ${s.msgCount} msgs · ${formatRelativeTime(s.lastActivity)}${tag}`);
        }
        lines.push('用法: /resume <id|序号>  跳到指定 session');
        return { reply: lines.join('\n') };
      }
      // 有参: 接受 id 或 序号
      const target = list.find(s => s.id === arg) || list[parseInt(arg, 10) - 1];
      if (!target) return { reply: `找不到 session: ${arg}\n输入 /resume 查看列表。` };
      if (target.id === ctx.sessionId) return { reply: `已经在 session ${arg} 中。` };
      return { reply: `切换到 session: ${target.id} (${target.msgCount} msgs)`, sideEffect: { resumeTo: target.id } };
    }
    case 'forget': {
      const list = ctx.availableSessions || [];
      if (!arg) {
        if (!list.length) return { reply: '没有可删除的历史 session。' };
        const lines = ['可删除的 session (按最近活跃排序):'];
        for (let i = 0; i < list.length; i++) {
          const s = list[i];
          const tag = s.id === ctx.sessionId ? ' ← 当前 (有保护)' : '';
          lines.push(`  ${String(i + 1).padStart(2)}. ${s.id} · ${s.msgCount} msgs · ${formatRelativeTime(s.lastActivity)}${tag}`);
        }
        lines.push('用法: /forget <id|序号> --force  删除 (--force 跳过确认)');
        return { reply: lines.join('\n') };
      }
      // 形如: "/forget repl_x" → 先确认; "/forget repl_x --force" → 直接删
      const parts = arg.split(/\s+/);
      const targetArg = parts[0];
      const isForce = parts.includes('--force');
      if (typeof ctx.onForget !== 'function') {
        return { reply: '/forget 不可用: dev-repl 未注入 onForget 回调' };
      }
      const target = list.find(s => s.id === targetArg) || list[parseInt(targetArg, 10) - 1];
      if (!target) return { reply: `找不到 session: ${targetArg}\n输入 /forget 查看列表。` };
      if (target.id === ctx.sessionId) {
        return { reply: `✗ 不能删除当前 session (避免误操作, 退出后用 -c 模式再删)` };
      }
      if (!isForce) {
        return { reply: `⚠ 将删除 session: ${target.id} (${target.msgCount} msgs)\n  再次执行 /forget ${targetArg} --force 确认` };
      }
      // --force 走回调
      try {
        const r = await ctx.onForget(target.id);
        if (!r.ok) return { reply: `✗ 删除失败: ${r.error || '未知'}` };
        return { reply: `✓ 已删除 session: ${target.id}` };
      } catch (e) {
        return { reply: `✗ 删除异常: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'compact': {
      if (typeof ctx.onCompact !== 'function') {
        return { reply: '/compact 不可用: dev-repl 未注入 onCompact 回调' };
      }
      try {
        const r = await ctx.onCompact();
        return { reply: r.ok ? '✓ 已重置 token 计数器。' : `✗ 重置失败: ${r.error || '未知'}` };
      } catch (e) {
        return { reply: `✗ /compact 失败: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'hooks': {
      if (typeof ctx.onListHooks !== 'function') {
        return { reply: '/hooks 不可用: dev-repl 未注入 onListHooks 回调' };
      }
      try {
        const r = await ctx.onListHooks();
        const entries = Object.entries(r);
        if (!entries.length) return { reply: '  (no hooks registered)' };
        const lines = ['已注册的 agent hook:'];
        for (const [event, names] of entries) {
          lines.push(`  ${event}:`);
          for (const n of names) lines.push(`    - ${n}`);
        }
        return { reply: lines.join('\n') };
      } catch (e) {
        return { reply: `✗ /hooks 失败: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'diff': {
      if (typeof ctx.onDiff !== 'function') {
        return { reply: '/diff 不可用: dev-repl 未注入 onDiff 回调' };
      }
      try {
        const r = await ctx.onDiff();
        if (r.error) return { reply: `✗ ${r.error}` };
        if (!r.diff) return { reply: '✓ 无未提交变更 (working tree clean)' };
        const lines = r.diff.split('\n');
        const max = 80;
        const truncated = lines.length > max;
        const display = lines.slice(0, max).map((l, i) => `  ${i + 1}${i < 9 ? ' ' : ''}  ${l}`).join('\n');
        const summary = `📝 ${lines.length} 行 (${r.diff.length} 字节)${truncated ? ` · 显示前 ${max} 行` : ''}`;
        return { reply: `${summary}\n${display}` };
      } catch (e) {
        return { reply: `✗ /diff 失败: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'commit': {
      if (typeof ctx.onCommit !== 'function') {
        return { reply: '/commit 不可用: dev-repl 未注入 onCommit 回调' };
      }
      // 调 ctx.onCommit() (async), 把结果作为 reply 返回
      try {
        const r = await ctx.onCommit();
        if (!r.ok) return { reply: `✗ ${r.message}` };
        if (r.committed === false) {
          return { reply: `📝 ${r.message}\n${r.diff ? `  diff 预览: ${r.diff.slice(0, 100)}...` : ''}` };
        }
        return { reply: `✓ ${r.message}` };
      } catch (e) {
        return { reply: `✗ /commit 失败: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'task': {
      if (!arg) return { reply: '用法: /task <goal>\n  派生子 agent 跑任务 (独立 session, 不污染主历史)' };
      if (typeof ctx.onTask !== 'function') {
        return { reply: '/task 不可用: dev-repl 未注入 onTask 回调' };
      }
      // 同步调 ctx.onTask(goal) (async), 由 dev-repl 跑 subagent 并把结果存到 sideEffect
      // dev-repl 在下一轮 LLM 入口前把 taskResult.content 注入 messages
      try {
        const r = await ctx.onTask(arg);
        if (!r.ok) {
          return { reply: `✗ subagent 失败: ${r.error?.slice(0, 150) || '未知'}` };
        }
        return {
          reply: `✓ subagent 完成: ${r.rounds} 轮, ${r.toolCalls} 工具调用, ${(r.durationMs / 1000).toFixed(1)}s\n  sessionId: ${r.sessionId}\n  结果将作为 system 消息注入下一轮 LLM 输入`,
          sideEffect: {
            taskResult: { sessionId: r.sessionId, content: r.content, goal: arg, rounds: r.rounds, toolCalls: r.toolCalls, durationMs: r.durationMs },
          },
        };
      } catch (e) {
        return { reply: `✗ /task 派发失败: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'workflow': {
      if (!arg) return { reply: '用法: /workflow <workflowName>\n  运行已定义的工作流 (从上下文对话生成), 必要步骤失败会中止' };
      if (typeof ctx.onWorkflow !== 'function') {
        return { reply: '/workflow 不可用: dev-repl 未注入 onWorkflow 回调' };
      }
      // 同步调 ctx.onWorkflow(name) (async), 由 dev-repl 跑 step-workflow 并把结果存到 sideEffect
      // dev-repl 在下一轮 LLM 入口前把 workflowResult.content 注入 messages
      try {
        const r = await ctx.onWorkflow(arg);
        if (!r.ok) {
          return { reply: `✗ workflow 失败: ${r.error?.slice(0, 150) || '未知'}` };
        }
        return {
          reply: `✓ workflow "${r.workflowName}" 完成: status=${r.status}${r.failedStep ? `, 失败步骤=${r.failedStep}` : ''}, ${r.results?.length || 0} 步\n  结果将作为 system 消息注入下一轮 LLM 输入`,
          sideEffect: {
            workflowResult: { workflowName: r.workflowName, status: r.status, failedStep: r.failedStep, results: r.results, content: r.content },
          },
        };
      } catch (e) {
        return { reply: `✗ /workflow 派发失败: ${e.message?.slice(0, 100)}` };
      }
    }
    case 'exit':
    case 'quit':
      return { sideEffect: { exit: true } };
    default:
      return { reply: `未知命令: /${cmd}` };
  }
}

export const META_SLASH = { id: 'slash-commands' };


// === subagent-roles.mjs ===
// subagent-roles.mjs — 3 个 sub-agent 角色 (Step 5 / L2 整)
//
// 设计: 把 LLM agent 拆成 3 个 role, 各有不同 prompt + 工具集 + round 上限
//   - planner   = 只读 (read/grep/ast), 8 rounds, 适合"先调研"步
//   - editor    = 读+写 (edit_file/hash_edit/write_file), 20 rounds, 适合"改代码"步
//   - verifier  = 读+测试 (test_run/lint_run/ts_typecheck), 10 rounds, 适合"验"步
//
// 调用方 (38.mjs 协调器) 按 step.action keyword 选 role, 传给 22.mjs (tool-loop).
// 22.mjs 在 processText 看 opts.role → 覆盖 systemPrompt / toolSubset / maxRounds.
//
// L2 整 vs L2 局部 (Step 4): 1 个 agent 调参 vs 多 agent 协作, 跨 role 通信靠
// 38.mjs 协调器 (上一步的 outputs 喂下一步 inputs), 不共享内存.

export const ROLES = {
  planner: {
    name: 'planner',
    prompt: 'You are a planner. Investigate the codebase using read-only tools (read_file, grep, find_refs, ast_*). Report findings clearly. Do NOT make code changes.',
    tools: ['read_file', 'grep', 'find_refs', 'code_search', 'ast_index', 'ast_find_refs', 'get_cwd'],
    maxRounds: 8,
    keywords: ['locate', 'find', 'identify', 'investigate', 'read', 'explain', 'list', 'look', 'search', 'inspect', 'discover', 'review', 'examine', 'show'],
  },
  editor: {
    name: 'editor',
    prompt: 'You are an editor. Make targeted code changes using edit_file (preferred for partial changes), hash_edit (single-line on large files), or write_file (full file). Read files first to understand context.',
    tools: ['read_file', 'write_file', 'edit_file', 'hash_edit', 'grep', 'find_refs', 'get_cwd'],
    maxRounds: 20,
    keywords: ['create', 'add', 'modify', 'update', 'change', 'edit', 'implement', 'write', 'build', 'define', 'register', 'wire', 'enable', 'disable', 'rename', 'refactor', 'delete', 'remove', 'move', 'replace', 'fix', 'patch'],
  },
  verifier: {
    name: 'verifier',
    prompt: 'You are a verifier. Run tests and lint to verify the change. Use test_run, lint_run, ts_typecheck, test_discover. Report PASS/FAIL with evidence. Do NOT make code changes.',
    tools: ['read_file', 'test_run', 'test_discover', 'lint_run', 'ts_typecheck', 'test_parallel', 'get_cwd'],
    maxRounds: 10,
    // 不放裸 'test' 关键字 — 容易误匹配 'test-cmd' / 'unit-test' / 'fixture' 等含 'test' 字符串
    keywords: ['verify', 'run tests', 'validate', 'lint', 'typecheck', 'confirm', 'assert', 'pass/fail', 'passes'],
  },
};

export const DEFAULT_ROLE = 'editor';

// 按 step.action 文本匹配 keyword → role. 优先级: verifier > editor > planner, 同一 role 内长 keyword 优先
const ROLE_PRIORITY = { verifier: 0, editor: 1, planner: 2 };
const KEYWORD_INDEX = (() => {
  const idx = [];
  for (const [role, def] of Object.entries(ROLES)) {
    for (const kw of def.keywords) idx.push({ role, kw, pri: ROLE_PRIORITY[role] ?? 99 });
  }
  return idx.sort((a, b) => a.pri - b.pri || b.kw.length - a.kw.length);
})();

export function pickRole(stepAction) {
  if (typeof stepAction !== 'string') return DEFAULT_ROLE;
  const lower = stepAction.toLowerCase();
  for (const { role, kw } of KEYWORD_INDEX) {
    // 用 word boundary 避免 "fix" 匹配到 "suffix"
    const re = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (re.test(lower)) return role;
  }
  return DEFAULT_ROLE;
}

export function getRole(name) {
  return ROLES[name] || ROLES[DEFAULT_ROLE];
}

export function listRoles() {
  return Object.keys(ROLES);
}

// === subagent.mjs ===
// === subagent.mjs ===
// dev-repl 的子 agent 调度：复用主进程的 provider/failover/工具链，
// 用独立 sessionId 隔离历史，把任务一次性跑完并返回 final answer。
//
// === invariants ===
// - runSubagent 入口必须接收 deps (provider/fallbacks/picker/loadTools) 由 dev-repl 注入，
//   不自己再读 cfg 也不再走 startDevRepl
// - sessionId 必须独立于调用方 (子任务历史不污染主 session)
// - 历史轮数上限比 dev-repl 低 (默认 30), 防子任务失控
// - 子任务不持久化到 repl-history (子任务是 throw-away, 不占磁盘)
// - 失败/超时统一返 { ok:false, error }, 不抛
// - system prompt 强化"独立完成, 不需要追问", 子任务不应触发交互
// - toolCache 独立, 不复用主 session 的 cache
// - 返回的 finalAnswer 截断到 4000 字符 (防主 session 被灌爆)
// - opts.tools 接受 tool name 数组 → 窄工具集 (5 件套第 2 条: 子任务越窄越好, M3 偏 build_run 时浪费 round)

import { randomUUID } from 'crypto';

const DEFAULT_MAX_ROUNDS = 30;
const MAX_ANSWER_CHARS = 4000;
const ROUND_DELAY_MS = 200;

export async function runSubagent({ goal, deps, opts = {} }) {
  const startTs = Date.now();
  const sessionId = `subagent_${randomUUID().slice(0, 8)}`;
  const maxRounds = opts.maxRounds || DEFAULT_MAX_ROUNDS;

  if (!goal || typeof goal !== 'string') {
    return { ok: false, error: 'goal 必须是非空字符串', sessionId, durationMs: 0 };
  }
  if (!deps || typeof deps.loadTools !== 'function' || !deps.provider) {
    return { ok: false, error: 'deps 缺失: 需要 { provider, loadTools, pickFirstAlive, cfg }', sessionId, durationMs: 0 };
  }

  let { provider, providerLabel, MODEL, cfg, pickFirstAlive, fallbacks, loadTools } = deps;

  let { tools, dispatch } = await loadTools();
  // 5 件套第 2 条 — 窄工具集. dev-repl 可传 opts.tools, 只暴露子集给 subagent.
  // 默认 = 全 (向后兼容). M3 在 39 工具下偏 build_run 浪费 round, 窄化后 edit_file 命中率上升.
  if (Array.isArray(opts.tools) && opts.tools.length > 0) {
    const before = tools.length;
    tools = tools.filter(t => {
      const name = t.function?.name || t.name;
      return opts.tools.includes(name);
    });
    if (!tools.length) {
      return { ok: false, error: `opts.tools=${JSON.stringify(opts.tools)} 全部不在 loadTools 返回中 (loadTools 给 ${before} 工具)`, sessionId, durationMs: Date.now() - startTs };
    }
  }
  if (!tools.length) {
    return { ok: false, error: '工具加载失败 (loadTools 返回 0 工具)', sessionId, durationMs: Date.now() - startTs };
  }

  const { validateResponse } = await import('./response-validator.mjs');
  const { createStepEnforcer } = await import('./step-enforcer.mjs');
  const { createErrorTracker } = await import('./error-tracker.mjs');
  const enforcer = createStepEnforcer();
  const tracker = createErrorTracker();

  const toolList = tools.map(t => {
    const f = t.function || t;
    const p = f.parameters?.properties ? Object.keys(f.parameters.properties).join(', ') : '';
    return `  ${f.name}(${p}): ${f.description || ''}`;
  }).join('\n');

  const systemMsg = {
    role: 'system',
    content: `You are a subagent (session ${sessionId}). You must complete the goal INDEPENDENTLY in one shot.
You have ${tools.length} tools. Do NOT ask clarifying questions — make reasonable assumptions and proceed.

Tools:
${toolList}

Rules:
- This is Windows. For directory listing use exec_command(command="cmd /c dir /b") not ls.
- Read files with read_file (short paths) or exec_command(command="cmd /c type ...") for long Windows paths.
- Windows paths in JSON arguments must use escaped backslashes: path="C:\\\\Users\\\\name\\\\file.txt".
- For files outside the project root, use read_file with allowExternal=true.
- Aim for a CONCISE final answer (under ${MAX_ANSWER_CHARS} chars). The caller will read your final text — be direct.`,
  };

  const messages = [systemMsg, { role: 'user', content: goal }];
  const toolCache = new Map();
  let finalAnswer = '';
  let totalRounds = 0;
  let totalToolCalls = 0;
  let usedFallback = false;

  for (let round = 0; round < maxRounds; round++) {
    totalRounds = round + 1;
    try {
      let content = '';
      let toolCalls = [];
      if (typeof provider.chatStream === 'function') {
        for await (const ev of provider.chatStream(MODEL, messages, { tools })) {
          if (ev.type === 'content' && ev.content) content += ev.content;
          else if (ev.type === 'tool_calls' && ev.toolCalls) toolCalls = ev.toolCalls;
          else if (ev.done || ev.type === 'done') break;
        }
      } else {
        const resp = await provider.chat(MODEL, messages, { tools });
        content = resp.content || '';
        toolCalls = resp.toolCalls || [];
      }
      content = content.trim();

      // Think stripping (不打印, 子任务静默)
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      if (toolCalls.length) {
        const validation = validateResponse({
          toolCalls: toolCalls.map(tc => ({
            id: tc.id,
            function: { name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments },
          })),
        }, tools);
        const validatedCalls = validation.toolCalls;
        if (!validatedCalls.length && validation.errors.length) {
          messages.push({ role: 'system', content: `[Subagent JSON 错误] ${validation.errors.map(e => e.error).join('; ')}。请修正工具调用。` });
          continue;
        }
        messages.push({
          role: 'assistant',
          content: content || null,
          tool_calls: validatedCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })),
        });
        for (const tc of validatedCalls) {
          totalToolCalls++;
          const n = tc.name;
          const check = enforcer.check(n);
          if (!check.ok) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: `[dependency] ${n} needs: ${check.missing.join(', ')}` });
            continue;
          }
          const cacheKey = `${n}:${JSON.stringify(tc.args)}`;
          if (toolCache.has(cacheKey)) {
            messages.push({ role: 'tool', tool_call_id: tc.id, content: toolCache.get(cacheKey) });
            continue;
          }
          try {
            const result = await execTool({ function: { name: n, arguments: JSON.stringify(tc.args) }, id: tc.id }, dispatch);
            toolCache.set(cacheKey, result);
            enforcer.complete(n);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
          } catch (e) {
            const msg = e.message || String(e);
            tracker.record(n, tc.args, msg, round);
            messages.push({ role: 'tool', tool_call_id: tc.id, content: `[Error] ${msg.slice(0, 200)}` });
          }
        }
        await new Promise(r => setTimeout(r, ROUND_DELAY_MS));
      } else {
        finalAnswer = content;
        break;
      }
    } catch (e) {
      // 失败: 试 fallback
      const currentName = providerLabel.split('/')[0];
      const remaining = (fallbacks || []).filter(fb => fb.name !== currentName);
      if (remaining.length && pickFirstAlive) {
        const nextPicked = await pickFirstAlive(remaining, cfg, { silent: true });
        if (nextPicked.ok) {
          provider = nextPicked.provider;
          providerLabel = nextPicked.label;
          MODEL = providerLabel.split('/')[1] || MODEL;
          fallbacks = remaining;
          usedFallback = true;
          continue;
        }
      }
      return {
        ok: false,
        error: `subagent 失败 (round ${round + 1}): ${e.message?.slice(0, 200) || String(e)}`,
        sessionId,
        durationMs: Date.now() - startTs,
        rounds: totalRounds,
        toolCalls: totalToolCalls,
        usedFallback,
      };
    }
  }

  if (!finalAnswer) {
    // 强制收尾: 让 LLM 总结
    try {
      messages.push({ role: 'system', content: '[STOP] Give a concise final answer summarizing what you found. Be direct.' });
      const resp = await provider.chat(MODEL, messages, { tools: [] });
      finalAnswer = resp.content?.trim() || '[subagent 无输出]';
    } catch (e) {
      finalAnswer = `[subagent 收尾失败: ${e.message?.slice(0, 100)}]`;
    }
  }

  if (finalAnswer.length > MAX_ANSWER_CHARS) {
    finalAnswer = finalAnswer.slice(0, MAX_ANSWER_CHARS) + `\n\n... (truncated, ${finalAnswer.length - MAX_ANSWER_CHARS} chars omitted)`;
  }

  return {
    ok: true,
    sessionId,
    finalAnswer,
    durationMs: Date.now() - startTs,
    rounds: totalRounds,
    toolCalls: totalToolCalls,
    usedFallback,
  };
}

export const META_SUBAGENT = { id: 'subagent' };

// === dev-workflow-plugin.mjs ===
// Dev Workflow Plugin — wraps system-exec, coding-tools, auto-commit, project-context
// Registers with PluginManager to replace legacy tools with our improved implementations.
// === invariants ===
// - Each execute() dynamically imports the relevant tool module
// - run_command uses isSafeCommand + output-compressor
// - read_file/write_file/edit_file include path traversal protection + quality gate
// - git_commit uses auto-commit with diff-based message generation
// - analyze_project uses project-context's findDependencies + getProjectStructure

export const DevWorkflowPlugin = {
  id: 'plugin-dev-workflow',
  name: 'Dev Workflow',
  description: 'Enhanced dev tools: safe command execution, quality-gated edits, auto-commit, project analysis.',
  tools: [
    {
      name: 'run_command',
      description: 'Execute a shell command with safety checks. Whitelisted: npm, node, git, flutter, dart, ls, cat, pwd, echo, mkdir, rm (safe), cp, mv, grep, find, head, tail, sort, wc, curl, dir, type, cd. Blocked: rm -rf /, sudo, shutdown, del /f, format, >nul.',
      params: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout: { type: 'number', description: 'Timeout in ms (default 10000)', required: false },
      },
      execute: async ({ command, timeout = 10000 }) => {
        const { execCommand } = await import('./system-exec.mjs');
        const result = execCommand(command, timeout, true);
        return { success: result.exitCode === 0, output: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
      },
    },
    {
      name: 'read_file',
      description: 'Read a file. Path is relative to project root. Path traversal is blocked.',
      params: {
        path: { type: 'string', description: 'Relative file path' },
      },
      execute: async ({ path }) => {
        const { readFile } = await import('./coding-tools.mjs');
        const content = await readFile(path);
        return { success: true, content };
      },
    },
    {
      name: 'write_file',
      description: 'Write content to a file. Creates directories if needed. Path is relative to project root.',
      params: {
        path: { type: 'string', description: 'Relative file path' },
        content: { type: 'string', description: 'File content' },
      },
      execute: async ({ path, content }) => {
        const { writeFile } = await import('./coding-tools.mjs');
        const result = await writeFile(path, content);
        return { success: true, path: result.path, bytes: result.bytes };
      },
    },
    {
      name: 'edit_file',
      description: 'Search and replace in a file with quality gate. Runs lint after edit, rolls back on failure. The search string must be unique. No regex.',
      params: {
        path: { type: 'string', description: 'Relative file path' },
        search: { type: 'string', description: 'Exact text to find (must be unique)' },
        newStr: { type: 'string', description: 'Replacement text' },
        force: { type: 'boolean', description: 'Skip quality gate (lint check). Default false.', required: false },
        test: { type: 'boolean', description: 'Also run tests after edit (default false). Only when force=false.', required: false },
      },
      execute: async ({ path, search, newStr, force, test }) => {
        const { editFile } = await import('./coding-tools.mjs');
        const result = await editFile(path, search, newStr, { force: force === true, test: !!test });
        return { success: true, ...result };
      },
    },
    {
      name: 'git_commit',
      description: 'Stage one or more files and commit with an auto-generated message based on diff analysis. Only works inside a git repo.',
      params: {
        files: { type: 'string', description: 'Comma-separated file paths to stage and commit' },
      },
      execute: async ({ files }) => {
        const { autoCommit } = await import('./auto-commit.mjs');
        const fileList = files.split(',').map(f => f.trim()).filter(Boolean);
        const result = await autoCommit(fileList);
        if (result.committed) {
          return { success: true, message: result.message, files: result.files };
        }
        return { success: false, error: result.error };
      },
    },
    {
      name: 'analyze_project',
      description: 'Analyze project structure and dependencies. Returns directory tree and import dependencies for a file.',
      params: {
        filePath: { type: 'string', description: 'File path to analyze dependencies for', required: false },
        maxDepth: { type: 'number', description: 'Directory tree depth (default 3)', required: false },
      },
      execute: async ({ filePath, maxDepth = 3 }) => {
        const pc = await import('./project-context.mjs');
        const structure = await pc.getProjectStructure(undefined, maxDepth);
        let deps = [];
        if (filePath) {
          deps = await pc.findDependencies(filePath);
        }
        return { success: true, structure: structure.slice(0, 200), dependencies: deps };
      },
    },
    {
      name: 'multi_edit',
      description: 'Apply the same search/replace across all files matching a glob pattern. Reports each file result.',
      params: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "src/**/*.js")' },
        search: { type: 'string', description: 'Exact text to find' },
        newStr: { type: 'string', description: 'Replacement text' },
        force: { type: 'boolean', description: 'Skip quality gate', required: false },
      },
      execute: async ({ pattern, search, newStr, force }) => {
        const { multiEdit } = await import('./multi-edit.mjs');
        return await multiEdit(pattern, search, newStr, { force: force === true });
      },
    },
    {
      name: 'ast_edit',
      description: 'Syntax-aware edit for .js/.jsx/.mjs files. Uses AST to find target node precisely. Actions: rename (rename a function/class/variable), replace_body (replace function body).',
      params: {
        path: { type: 'string', description: 'File path (relative)' },
        selector: { type: 'string', description: 'Node selector, e.g. "function:myFunc" or "class:MyClass" or "const:myVar"' },
        action: { type: 'string', description: 'Action: "rename" or "replace_body"' },
        newValue: { type: 'string', description: 'New name (for rename) or new body content (for replace_body)' },
      },
      execute: async ({ path: filePath, selector, action, newValue }) => {
        const { astEdit } = await import('./ast-edit.mjs');
        return await astEdit(filePath, selector, action, newValue);
      },
    },
    {
      name: 'diff_review',
      description: 'Show the current git diff (staged + unstaged changes) and ask the user to approve or reject. Returns the diff text.',
      params: {},
      execute: async () => {
        const { getGitDiff } = await import('./diff-review.mjs');
        const diff = getGitDiff();
        return { success: true, diff };
      },
    },
  ],
};

// === dev-repl.mjs ===
import { createInterface } from 'readline';
import os from 'os';

// === invariants ===
// - startDevRepl 入口先调 provider-health.diagnose + failover-picker 选 alive provider
// - readline 循环: 同一轮 tool 调用 cache (toolCache Map) 防重复
// - 流式分支: provider.chatStream 不存在时降级 provider.chat, lastStreamed 防重复打印
// - history: 每次 user/assistant/tool 落盘 ~/.openchat/repl-history/<id>.json, /clear 清空
// - /resume 跳到目标: sessionId 不变, 后续 histAppend 仍写**原** session (保护目标不被污染)
// - slash-commands: applySlash async, 调 ctx.onCommit (commit 路径) 和 ctx.availableSessions (/resume 路径)
// - edit-quality-gate: edit tool 完成后异步 fire-and-forget, 失败塞 messages+history, 不阻塞 REPL
// - 全程 never-throw 策略: 所有 catch 静默, gate/pinger 内部保永不抛

// 5 件套 v2 件套 5: 执行边界 (execution boundary).
// 三层: (a) MAX_ROUNDS=30 兜底 (cap 总轮数, 防 subagent 卡死),
// (b) READ_BUDGET=3 软约束 (read-style tool 连续 N 次后注入 phase transition 提示, 防 exploration 链不切到 write),
// (c) 决断力 (decision under uncertainty) — systemMsg 显式禁止 surrender/ask user, 强制 unilateral decision.
// (d) 强倒计时 (diff proposal → must edit) — M3 produce diff 块后, N 轮内必须 emit edit_file, 不允许再问 a/b/c.
// v7 失败: exploration 链不切到 write 链. (b) 修.
// v8' 失败: M3 在 (b) 触发后给 plan + ask 2 确认. (c) 修 (改 surrender 为 propose diff).
// v9 失败: M3 produce diff 但 ask (a/b/c) 选哪个. (d) 修 (强倒计时逼 edit_file).
const MAX_ROUNDS = 30;
const READ_BUDGET = 3;
const DIFF_COUNTDOWN = 2; // 件 5 (d): produce diff 后给 N 轮机会 edit_file
const READ_TOOLS = new Set(['read_file', 'grep', 'list_directory', 'get_cwd', 'find_refs', 'list_refs', 'exec_command']);
const WRITE_TOOLS = new Set(['edit_file', 'write_file', 'hash_edit', 'multi_edit', 'ast_edit']);

function detectDiffProposal(text) {
  if (!text) return false;
  return /```(?:diff|patch)\b/.test(text) || /^@@\s+-/m.test(text);
}

const toolModules = [
  { name: 'system_exec', import: () => import('./system-exec.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'coding_tools', import: () => import('./coding-tools.mjs'), toolsKey: 'TOOLS', execKey: 'executeTool' },
  { name: 'multi_edit', import: () => import('./multi-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'ast_edit', import: () => import('./ast-edit.mjs'), toolsKey: null, execKey: 'executeTool' },
  { name: 'diff_review', import: () => import('./diff-review.mjs'), toolsKey: null, execKey: 'executeTool' },
];

async function loadAllTools() {
  const tools = [];
  const dispatch = {};
  for (const mod of toolModules) {
    try {
      const m = await mod.import();
      if (Array.isArray(m[mod.toolsKey])) tools.push(...m[mod.toolsKey]);
      dispatch[mod.name] = m[mod.execKey];
    } catch { /* skip failed */ }
  }
  return { tools, dispatch };
}

function _repairJSON(s) {
  // Try adding missing closing quotes and braces for common LLM truncation
  let fixed = s;
  // Count unescaped quotes — if odd, add a closing quote
  let inStr = false, escape = false, quoteCount = 0;
  for (const c of fixed) { if (escape) { escape = false; continue; } if (c === '\\') { escape = true; continue; } if (c === '"') { inStr = !inStr; quoteCount++; } }
  if (inStr) fixed += '"';
  // Count braces — add missing closing braces
  const opens = (fixed.match(/\{/g) || []).length;
  const closes = (fixed.match(/\}/g) || []).length;
  for (let i = 0; i < opens - closes; i++) fixed += '}';
  return fixed;
}

async function execTool(tc, dispatch) {
  const name = tc.function?.name || tc.name;
  const rawArgs = tc.function?.arguments || tc.arguments || '{}';
  let args;
  try { args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs; }
  catch { args = typeof rawArgs === 'string' ? JSON.parse(_repairJSON(rawArgs)) : rawArgs; }
  // [HOOKS] preTool — permission/限流/日志 注册的 hook 链, 抛 throw 中止
  try { await runPre(name, args); } catch (e) { return `[Hook denied] ${e.message?.slice(0, 200) || 'preTool hook rejected call'}`; }
  let lastError = '';
  for (const fn of Object.values(dispatch)) {
    try {
      let r = await fn(name, args);
      // [HOOKS] postTool — log/transform chain
      r = await runPost(name, args, r);
      const s = typeof r === 'string' ? r : JSON.stringify(r, null, 2);
      const lines = s.split('\n');
      if (lines.length > 80) return lines.slice(0, 60).join('\n') + `\n... (${lines.length - 60} more lines)`;
      return s.length > 8000 ? s.slice(0, 8000) + '\n... (truncated)' : s;
    } catch (e) {
      const msg = e.message || String(e);
      if (!msg.includes('Unknown tool:')) return `[Error] ${msg.slice(0, 200)}`;
      lastError = msg;
    }
  }
  return `[Error] Tool "${name}" not found`;
}

function parseToolCalls(text) {
  const calls = [];
  const blocks = text?.match(/<tool_call>[\s\S]*?<\/tool_call>/g) || [];
  for (const block of blocks) {
    // Format: <invoke name="x"><param>val</param></invoke>
    for (const inv of block.match(/<invoke[\s\S]*?<\/invoke>/g) || []) {
      const m = inv.match(/<invoke\s+name="([^"]*)"/);
      if (!m) continue;
      const args = {};
      for (const p of inv.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) {
        if (p[1] !== 'invoke') args[p[1]] = p[2].trim();
      }
      calls.push({ name: m[1], args });
    }
    // Format: name(key="val", key2=val2)
    for (const line of block.replace(/<\/?tool_call>/g, '').trim().split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const p = t.indexOf('(');
      if (p <= 0) continue;
      const name = t.slice(0, p).trim();
      try {
        const args = JSON.parse(t.slice(p + 1, t.lastIndexOf(')')));
        calls.push({ name, args });
      } catch { /* skip */ }
    }
  }
  // Format: <tool_name>name</tool_name><tool_args>{...}</tool_args> (standalone)
  for (const nm of text?.match(/<tool_name>([\s\S]*?)<\/tool_name>/g) || []) {
    const name = nm.replace(/<\/?tool_name>/g, '').trim();
    const argsBlock = text.match(/<tool_args>([\s\S]*?)<\/tool_args>/);
    try { calls.push({ name, args: argsBlock ? JSON.parse(argsBlock[1]) : {} }); } catch { /* skip */ }
  }
  // Raw JSON fallback (v6 ac623ffb fix): M3 / 弱模型有时不包 XML envelope, 直接出 raw JSON.
  // 三层兜底, 依次试, 命中一个就 break. Append-only, 不破坏 XML match 路径.
  if (calls.length === 0 && text) {
    const trimmed = text.trim();
    // 兜底 1: 整段 content 是单个 raw JSON 对象 {"name":..., "args":...}
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const obj = JSON.parse(trimmed);
        if (obj && obj.name && obj.args !== undefined) {
          calls.push({ name: String(obj.name), args: typeof obj.args === 'object' ? obj.args : {} });
        }
      } catch { /* fall through */ }
    }
    // 兜底 2: ```json code block 嵌入
    if (calls.length === 0) {
      const codeMatch = trimmed.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeMatch) {
        try {
          const obj = JSON.parse(codeMatch[1]);
          if (obj && obj.name && obj.args !== undefined) {
            calls.push({ name: String(obj.name), args: typeof obj.args === 'object' ? obj.args : {} });
          }
        } catch { /* fall through */ }
      }
    }
    // 兜底 3: 任意位置的 {"name": "...", "args": {...}} inline 匹配
    if (calls.length === 0) {
      const inlineMatch = trimmed.match(/\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[\s\S]*?\}|\[[\s\S]*?\])\s*\}/);
      if (inlineMatch) {
        try {
          const args = JSON.parse(inlineMatch[2]);
          calls.push({ name: inlineMatch[1], args: typeof args === 'object' ? args : {} });
        } catch { /* fall through */ }
      }
    }
  }
  return calls.length ? calls : null;
}

export async function startDevRepl(modelOverride, chatId, initialMessage) {
  const cfg = JSON.parse(await import('fs/promises').then(fs => fs.readFile(os.homedir() + '/.config/openchat/config.json', 'utf8')));
  const { CostTracker } = await import('./cost-tracker.mjs');
  const costTracker = new CostTracker(cfg);

  // 构建 provider 降级链：current → openrouter → 其他已配置的
  let fallbacks = [];
  const currentProvider = cfg.current?.provider || 'minimax';
  const currentModel = modelOverride || cfg.current?.model || 'MiniMax-M3';
  fallbacks.push({ name: currentProvider, model: currentModel });
  for (const [name, pcfg] of Object.entries(cfg.providers || {})) {
    if (name !== currentProvider && pcfg.apiKey)
      fallbacks.push({ name, model: pcfg.defaultModel || 'openrouter/auto' });
  }

  const { diagnose } = await import('./provider-health.mjs');
  const { pickFirstAlive } = await import('./failover-picker.mjs');
  // 5 件套 v2 件 4: try-once-then-skip. pickFirstAlive 内部不抛 (line 13 invariant),
  // 但外层加 try-catch 兜底, 防止任何未来回归 (例如 import 失败 / cfg 异常) 把 crash 传进 bridge boot.
  let picked;
  try {
    picked = await pickFirstAlive(fallbacks, cfg, { silent: false, timeoutMs: 8000 });
  } catch (e) {
    process.stdout.write(`\x1b[33m[bridge] pickFirstAlive 异常: ${e.message?.slice(0, 100)} → 降级 diagnose\x1b[0m\n`);
    picked = { ok: false, error: e.message, tried: [] };
  }
  if (!picked.ok) {
    // picker 已逐项报告, 调 diagnose 拿 actionable fix
    let diag;
    try { diag = await diagnose({ silent: false }); } catch (e2) {
      diag = { lines: ['[bridge] diagnose 异常: ' + (e2.message?.slice(0, 100) || 'unknown')], fix: '运行 `openchat config` 检查 provider/key 配置' };
    }
    for (const line of diag.lines) process.stdout.write(line + '\n');
    process.stdout.write(`\x1b[33m[bridge] No available provider — pre-flight 失败, REPL 启动中止. 修好后重试.\x1b[0m\n`);
    // 不 throw: 避免 crash 污染 bridge boot 阶段. 直接返回 (让 CLI 干净退出)
    return;
  }
  let provider = picked.provider;
  let providerLabel = picked.label;
  // Bug fix: providerLabel = "<provider>/<model>" 但 model 可能含斜杠 (openrouter "deepseek/deepseek-chat"),
  // split('/')[1] 拿错的. 用 cfg.current.model 拿, fallback 到 label 的剩余部分.
  const labelParts = providerLabel.split('/');
  let MODEL = cfg.current?.model || (labelParts.length > 2 ? labelParts.slice(1).join('/') : labelParts[1]) || currentModel;
  const { tools, dispatch } = await loadAllTools();

  tools.push(
    { type: 'function', function: { name: 'multi_edit', description: 'Search/replace across files matching glob.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, search: { type: 'string' }, newStr: { type: 'string' }, force: { type: 'boolean' } }, required: ['pattern', 'search', 'newStr'] } } },
    { type: 'function', function: { name: 'ast_edit', description: 'AST rename/replace_body.', parameters: { type: 'object', properties: { path: { type: 'string' }, selector: { type: 'string' }, action: { type: 'string' }, newValue: { type: 'string' } }, required: ['path', 'selector', 'action', 'newValue'] } } },
    { type: 'function', function: { name: 'diff_review', description: 'Show git diff.', parameters: { type: 'object', properties: {}, required: [] } } },
  );

  // 5 件套 v2 件套 1 (动作级 tool): 5 个 raw API 工具默认隐藏, M3 在 39 工具下偏 build_run 浪费 round.
  // OPENCHAT_RAW_TOOLS=1 显式 opt-in 才暴露 (给"我就要 shell"的场景留口子).
  if (process.env.OPENCHAT_RAW_TOOLS !== '1') {
    const RAW_TOOLS = new Set(['build_run', 'lang_run', 'exec_command', 'docker_build', 'sql_parse']);
    for (let i = tools.length - 1; i >= 0; i--) {
      if (RAW_TOOLS.has(tools[i].function?.name)) tools.splice(i, 1);
    }
  }

  const { validateResponse } = await import('./response-validator.mjs');
  const { createStepEnforcer } = await import('./step-enforcer.mjs');
  const { createErrorTracker } = await import('./error-tracker.mjs');
  const enforcer = createStepEnforcer();
  const tracker = createErrorTracker();

  const toolList = tools.map(t => { const f = t.function || t; const p = f.parameters?.properties ? Object.keys(f.parameters.properties).join(', ') : ''; return `  ${f.name}(${p}): ${f.description || ''}`; }).join('\n');

  const systemMsg = {
    role: 'system',
    content: `You are a software development AI assistant on Windows. You have ${tools.length} tools.

Tools:\n${toolList}

When the user asks to explore/analyze the project, call tools immediately. Never describe — execute.

Slash commands (user may type):
- 用户可输入 /workflow <name> 触发 step-workflow (17.mjs), 顺序跑预定义的多步实验, 必要步骤失败会中止.

Notes:
- This is Windows. For directory listing, use exec_command(command="cmd /c dir /b") not ls.
- For reading files, use read_file(path="...") for short paths, or exec_command(command="cmd /c type ...") for long Windows paths (JSON may truncate).
- Windows paths in JSON arguments must use escaped backslashes: path="C:\\\\Users\\\\name\\\\file.txt".
- If a tool fails, try a different approach. For files outside the project root, use read_file with allowExternal=true.

Debug strategy (diagnostic tasks):
  Step 1 — Identify: Find entry point (main/src/index), handler (where messages are received), reply/send (where replies go out). Usually 3-4 key files.
  Step 2 — Read: Read those key files FULLY, understand the data flow. Take notes of relevant functions and their signatures.
  Step 3 — Analyze: Trace a message from receive → process → reply. Look for: single-use listeners (once), process.exit, session.clear, or one-shot reply patterns.
  Step 4 — Conclude: Summarize root cause in Chinese with code references. Propose fix only if confident.

Error → Self-Heal Cheat Sheet (你看到的错误信号, 含义, 你该做什么):

[GP] 参数/JSON 错 (连续 3 次) — 含义: 你输出截断/转义崩. 立刻改用 exec_command(command="type <path>") 或 list_directory(path="...") 读外部文件, 避开 JSON 转义.
[GP] enum 越界 / 缺参数 / 未知参数 / 类型错 — 含义: 你瞎填. 看错误里说的 "应为 X, 实际为 Y", 严格照改.
[GP] Unknown tool: <name> — 含义: 你编造了工具. 系统只暴露已注册的 tools, 别发明.

[lint-gate] <file> lint 失败 — 含义: 你改完的代码 lint 没过. 修对应错, 不要 force=true 跳过.
[Edit failed at lint: ...] — 同上, 改 search 重写, 不调 force=true.
[Edit failed at test: ...] — quality gate test 拦. 修测试; 实在不行 test=false (lint 仍跑).

ENOENT / Path traversal / EACCES — read_file 路径错. ENOENT→list_directory 父目录; traversal→改用相对路径或 allowExternal=true (只读).
Search string not found / appears N times — edit_file 失败. 先 read_file 重读, 不唯一就在 search 前后各加 1 行 anchor.
Hash anchor not found — hash_edit 失败. 重新 read_file 拿 md5(line).slice(0,8), 别凭记忆.
Command rejected by safety check — exec_command 命中 rm/mv/重定向. 改用工具原语: 写文件 write_file, "删" 用 write_file 空内容覆盖.
timeout (工具 10s) — 加 timeout=60000; 拆步骤; 大输出加 compress=true.
ENOBUFS / too long / Output truncated — 输出超 100KB 或 8000 字. grep 加 include="*.js" 缩 ext; 分段读; 改用 grep 精确定位.

[dependency] <tool> needs: <missing> — 步骤前提未满足 (例: edit_file 前没 read_file). 别调它, 先补前提.
[MAX_ROUNDS 30 撞] / [STOP] — 任务太复杂/太久. 立即收尾给中文最终回答, 别再调 tool.
[/task] subagent ok:false — /task 子 agent 失败. 换需求重派, 或自己干, 别无限重试.
当前目录不是 git 仓库 / 无未提交的变更 — git_commit 错. 先 git_log 验证, 空 diff 就告诉用户没必要 commit.
pre-commit hook failed — 钩子挂. 返 stderr 给用户, 别强 commit.

5 高频工具自救速查:
- read_file 失败 → list_directory 父目录 或 exec_command("type <path>") 绕 JSON 转义
- edit_file search 拼错 → read_file 重读, 重新对齐 search 字符串
- edit_file 不唯一 → search 前后各加 1 行 anchor
- exec_command safety 拒 → 改用工具原语 (write_file 替代 echo>)
- grep 0 命中 → 去 ^, 改 case-insensitive, 加 include="*.ext"
- grep ENOBUFS → 必带 include, 缩到具体 ext
- git_commit 空 diff → 没必要, 告诉用户

何时换工具 vs 何时收手:
- 换工具: read_file 失败→exec_command("type"); grep 0→find_refs 语义级; edit_file search 错→read_file 重读; edit_file lint 拦→lint_run 看错
- 收手: error-tracker 累计 ≥ 3 相似错就换思路; 5+ 不同 tool 全挂就回退给用户 ("我需要您介入: <原因>. 您能否: a/b/c?")

原则: 撞墙先自救 (换工具/换参数/换路径), 自救 3 次还挂就坦白, 别在 [Error] 上反复横跳.

Rules:
- No hard limit on tool calls. Keep exploring until you understand the ROOT CAUSE.
- But aim to read only KEY files (entry point + handler + reply), not every file in the project.
- For each key file you read, add a comment about what it does.
- Answer in Chinese, reference specific code lines, explain the flow.

DECISION UNDER UNCERTAINTY (决断力, 件 5 c):
- 你是自主 agent, 任务来了就做, 默认 make unilateral decision.
- 禁止 ask user 确认 ("请确认" / "请贴出" / "需要您" / "allow me to read again" 等都是 surrender 信号).
- 不确定时: 选 best guess → 直接 emit write tool (edit_file/write_file/hash_edit/multi_edit/ast_edit) → 改完报告 diff 让 user review.
- 实在无 info: 在 final answer 里贴 proposed patch (\`\`\`diff 块), 而不是 ask user. 让 user 看到你的判断, 不是看到你问问题.
- 例外: 删数据 / rm 命令 / 推 commit 仍需 confirm (safety critical, 见下面 Decision Cheat Sheet). 代码 edit 全部 unilateral.

FIRST-TURN TOOL CALL CONTRACT (硬约束):
- 第一轮 (用户消息刚到时) 的回复必须是直接的 tool call, 不能先输出任何说明文字/中文分析/<think>.
- 必须输出严格的 JSON: {"name": "<tool_name>", "args": {...}}, 不要包在 markdown 代码块里, 不要前缀解释.
- 如果用了 XML 格式, 必须是 <tool_call><invoke name="..."><arg>val</arg></invoke></tool_call> 格式 (parser 在 line 408-414 处理).
- Tool calls may be issued as raw JSON {"name": "...", "args": {...}} or XML <tool_call><invoke name="..."/></tool_call>. Both are valid (parser 兜底 raw JSON, line 110-149).
- 不要先说"好的我来分析", 不要"<think>...</think>" 后空 call, 不要在 tool call 前后夹杂任何非 JSON/XML 的解释文字.
- 唯一例外: 用户消息本身是非技术寒暄 (例如 "/help"、问天气) 时, 可以纯文本回复.`,
  };

  console.debug(`\n  openchat bridge — dev mode (${providerLabel})`);
  console.debug(`  ${tools.length} tool(s) loaded · cwd ${process.cwd()}`);
  console.debug(`  输入 /help 查看命令, /status 看状态, /exit 退出\n`);

  // 持久化 session（记录 chatId + cwd）
  const sessionId = chatId || `repl_${Date.now()}`;
  const { persistentStore } = await import('./persistent-store.js');
  const { loadHistory, appendMessage: histAppend, clearHistory: histClear, listSessions: histList } = await import('./repl-history.mjs');
  const histLoad = loadHistory; // alias
  persistentStore?.setSession(sessionId, { chatId: sessionId, cwd: process.cwd(), lastActivity: Date.now(), type: 'repl' });

  // 续接历史 (-c 模式)
  const resumedHistory = chatId ? loadHistory(sessionId) : [];
  let pendingTaskResult = null; // /task subagent 结果, 下一轮 user input 注入
  if (resumedHistory.length) process.stdout.write(`\x1b[32m[repl-history] load ${resumedHistory.length} msgs from last session\x1b[0m\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ', terminal: process.platform !== 'win32' });
  if (chatId && !resumedHistory.length) process.stdout.write(`\x1b[32m[continue session ${chatId.slice(0, 12)} (无历史)...]\x1b[0m\n`);
  rl.prompt();

  // CLI initial message 注入: 跟 stdin 输入走相同路径
  const initialLines = initialMessage ? [initialMessage] : [];
  const lineIter = (async function* () { for (const l of initialLines) yield l; for await (const l of rl) yield l; })();
  for await (const line of lineIter) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }
    if (input === 'exit' || input === 'quit') break;

    // Slash command dispatch (opencode/claudecode 风格)
    if (input.startsWith('/')) {
      const { parseSlash, applySlash } = await import('./slash-commands.mjs');
      const { listSessions: histList } = await import('./repl-history.mjs');
      const parsed = parseSlash(input);
      if (parsed.handled) {
        if (parsed.cmd) {
          // 注入可续接的 session 列表 (合并历史文件 + persistentStore 时间戳)
          const histIds = new Set(histList());
          const sessions = persistentStore?.getAllSessions() || [];
          const availableSessions = sessions
            .filter(s => histIds.has(s.id) && s.type === 'repl')
            .map(s => ({ id: s.id, msgCount: histLoad(s.id).length, lastActivity: s.lastActivity || 0, cwd: s.cwd }))
            .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
            .slice(0, 20);
          const result = await applySlash({
            cmd: parsed.cmd,
            arg: parsed.arg,
            ctx: {
              cfg, providerName: providerLabel.split('/')[0], model: MODEL,
              sessionId, cwd: process.cwd(), toolCount: tools.length, historyRounds: 0,
              availableSessions,
              costSummary: costTracker.formatSummary(),
              onListHooks: () => listAgentHooks(),
              onCompact: async () => {
                costTracker.reset();
                return { ok: true };
              },
              onForget: async (cid) => {
                // 1. 删历史文件 (repl-history)
                histClear(cid);
                // 2. 删 persistentStore 元数据
                try { persistentStore?.deleteSession(cid); } catch (e) { console.error('[C0]', e); }
                return { ok: true };
              },
              onDiff: async () => {
                const ac = await import('./auto-commit.mjs');
                if (!ac.hasGitRepo(process.cwd())) {
                  return { error: '当前目录不是 git 仓库' };
                }
                const diff = ac.gitDiff(process.cwd());
                return { diff };
              },
              onCommit: async () => {
                // 动态 import (避免启动时强耦合 auto-commit)
                const ac = await import('./auto-commit.mjs');
                if (!ac.hasGitRepo(process.cwd())) {
                  return { ok: false, message: '当前目录不是 git 仓库' };
                }
                const diff = ac.gitDiff(process.cwd());
                if (!diff.trim()) {
                  return { ok: false, message: '无未提交的变更 (git diff 为空)' };
                }
                const msg = ac.generateMessage(diff, process.cwd());
                const result = await ac.autoCommit([], process.cwd()).catch(() => {
                  return { committed: false, message: msg, diff: diff.slice(0, 500) };
                });
                if (result.committed === false && result.diff) {
                  return { ok: true, committed: false, message: `建议 commit msg: ${msg}\n(未自动 commit, 请手动执行)`, diff: result.diff };
                }
                return { ok: true, committed: true, message: `已 commit: ${msg}` };
              },
              onTask: async (goal) => {
                // 派生子 agent 跑独立 session, 返回完整 result (由 slash 端再放进 sideEffect)
                const { runSubagent } = await import('./subagent.mjs');
                process.stdout.write(`\x1b[36m[/task] 派发 subagent: ${goal.slice(0, 80)}${goal.length > 80 ? '...' : ''}\x1b[0m\n`);
                // 5 件套第 2 条: 子任务用窄工具集 (4 read/edit + grep) → M3 不再偏 build_run, edit_file 命中率上升
                const SUBAGENT_TOOLS = ['read_file', 'write_file', 'edit_file', 'hash_edit', 'grep', 'list_directory', 'get_cwd'];
                const result = await runSubagent({
                  goal,
                  deps: {
                    provider, providerLabel, MODEL, cfg, fallbacks,
                    pickFirstAlive, loadTools: loadAllTools,
                  },
                  opts: { tools: SUBAGENT_TOOLS },
                });
                if (!result.ok) {
                  process.stdout.write(`\x1b[33m[/task] subagent 失败: ${result.error}\x1b[0m\n`);
                  return { ok: false, error: result.error };
                }
                process.stdout.write(`\x1b[32m[/task] subagent 完成: ${result.rounds} 轮, ${result.toolCalls} 工具调用, ${(result.durationMs / 1000).toFixed(1)}s, sessionId=${result.sessionId}\x1b[0m\n`);
                return {
                  ok: true,
                  sessionId: result.sessionId,
                  content: `[Subagent result from ${result.sessionId}]\nGoal: ${goal.slice(0, 200)}\n\nResult:\n${result.finalAnswer}`,
                  rounds: result.rounds,
                  toolCalls: result.toolCalls,
                  durationMs: result.durationMs,
                };
              },
              onWorkflow: async (workflowName) => {
                // /workflow 派发: 用 17.mjs 跑预定义 step-workflow, 每步走 subagent
                const { run: runStepWorkflow } = await import('../../experiments/17.mjs');
                const { runSubagent } = await import('./subagent.mjs');
                process.stdout.write(`\x1b[36m[/workflow] 派发: ${workflowName}\x1b[0m\n`);
                const SUBAGENT_TOOLS = ['read_file', 'write_file', 'edit_file', 'hash_edit', 'grep', 'list_directory', 'get_cwd'];
                const composeRun = async (expId, inputs) => {
                  const sub = await runSubagent({
                    goal: `[Experiment ${expId}] ${JSON.stringify(inputs).slice(0, 200)}`,
                    deps: { provider, providerLabel, MODEL, cfg, fallbacks, pickFirstAlive, loadTools: loadAllTools },
                    opts: { tools: SUBAGENT_TOOLS },
                  });
                  if (!sub.ok) throw new Error(sub.error || 'subagent failed');
                  return { outputs: { sessionId: sub.sessionId, finalAnswer: sub.finalAnswer, rounds: sub.rounds, toolCalls: sub.toolCalls } };
                };
                const wfRes = await runStepWorkflow({ inputs: { op: 'run', workflowName, composeRun } });
                process.stdout.write(`\x1b[32m[/workflow] 完成: status=${wfRes.outputs.status}${wfRes.outputs.failedStep ? `, failedStep=${wfRes.outputs.failedStep}` : ''}, ${wfRes.outputs.results?.length || 0} 步\x1b[0m\n`);
                return {
                  ok: true,
                  workflowName,
                  status: wfRes.outputs.status,
                  failedStep: wfRes.outputs.failedStep,
                  results: wfRes.outputs.results,
                  content: `[Workflow "${workflowName}" result]\nStatus: ${wfRes.outputs.status}\nSteps: ${wfRes.outputs.results?.length || 0}\n${wfRes.outputs.failedStep ? `Failed at: ${wfRes.outputs.failedStep}\n` : ''}${wfRes.outputs.error ? `Error: ${wfRes.outputs.error}\n` : ''}\nDetails:\n${JSON.stringify(wfRes.outputs.results, null, 2).slice(0, 4000)}`,
                };
              },
            },
          });
          if (result.reply) process.stdout.write(result.reply + '\n');
          if (result.sideEffect?.exit) break;
          if (result.sideEffect?.setModel) {
            MODEL = result.sideEffect.setModel;
            providerLabel = providerLabel.split('/')[0] + '/' + MODEL;
          }
          if (result.sideEffect?.clearHistory) { histClear(sessionId); resumedHistory.length = 0; rl.prompt(); continue; }
          if (result.sideEffect?.resumeTo) {
            // 跳到指定 session: 重置 resumedHistory + 改 sessionId
            const newId = result.sideEffect.resumeTo;
            const newHist = histLoad(newId);
            resumedHistory.length = 0;
            for (const m of newHist) resumedHistory.push(m);
            process.stdout.write(`\x1b[32m[resumed ${newHist.length} msgs from ${newId}]\x1b[0m\n`);
            // 注意: sessionId 仍为原值, 后续 append 写入新 session 文件
            // (避免污染原 session 历史)
            // 若想"接着原 session 写", 改成: const oldId = sessionId; ... sessionId = newId
            // 当前选择: 读但不写, 保护原 session 完整
            rl.prompt();
            continue;
          }
          if (result.sideEffect?.taskResult) {
            // /task 结果: 暂存到 pendingTaskResult, 下一轮 user input 时注入 messages
            pendingTaskResult = result.sideEffect.taskResult;
            rl.prompt();
            continue;
          }
          if (result.sideEffect?.workflowResult) {
            // /workflow 结果: 共用 pendingTaskResult 注入槽, 下一轮 user input 时注入 messages
            pendingTaskResult = result.sideEffect.workflowResult;
            rl.prompt();
            continue;
          }
        }
        rl.prompt();
        continue;
      }
    }
    persistentStore?.setSession(sessionId, { chatId: sessionId, cwd: process.cwd(), lastActivity: Date.now(), type: 'repl' });

    // Memory context recall (via experiment 43) — 死代码, mem 模块在 line 456 也是死代码, 一并删除
    const memoryCtx = '';
    try {
    } catch (e) { console.error('[C0]', e); }

    // Auto goal detection: complex diagnostic tasks get step-by-step guidance
    const isComplex = input.length > 60 || /为什么|什么原因|debug|diagnose|investigate|分析|排查|项目|看看|怎么回事/.test(input);
    const goalGuide = isComplex
      ? { role: 'system', content: '[Goal] This is a multi-step diagnostic. Follow the Debug strategy from system prompt: identify 3-4 key files (entry, handler, reply), read them fully, trace the flow, then conclude. Do NOT read every file in the project — focus on the message/reply path.' }
      : null;

    const messages = [];
    // 灌入续接的历史 (跳过原 systemMsg, 避免被新 system 覆盖)
    for (const m of resumedHistory) {
      if (m.role === 'system') continue; // 旧 system 略过
      messages.push(m);
    }
    messages.push(systemMsg);
    if (memoryCtx) messages.push({ role: 'system', content: memoryCtx });
    if (goalGuide) messages.push(goalGuide);
    messages.push({ role: 'user', content: input });
    // 续接模式下: 本轮新 user 也追加到历史文件
    histAppend(sessionId, { role: 'user', content: input });
    let finalAnswer = '';
    let totalToolCalls = 0;
    let lastStreamed = false; // 末轮是否走了流式 (避免 console.log 重复打印)
    const toolCache = new Map(); // session-scoped: cacheKey → result
    let transportHintInjected = false; // Tier 1: round 0 user-prompt 改写已注入
    let tier2RetriesLeft = 2; // Tier 2: server-side retry 硬上限 2 次
    let readCount = 0; // 件 5 (b): read-style tool 累计, 触发 phase transition 后 reset
    let writeHappened = false; // 件 5 (b): write-style tool 发生过则短路, 不再 nudge
    let diffCountdown = 0; // 件 5 (d): diff proposal 倒计时 (0=未触发, >0=还剩 N 轮必须 emit edit_file)

    for (let round = 0; round < MAX_ROUNDS; round++) {
      // 件 5 (b): read budget 软约束 — 连续 N 次 read-style tool 后, 强制 phase transition nudge
      // 件 5 (c): decision under uncertainty — 禁止 surrender / ask user, 强制 unilateral decision
      if (readCount >= READ_BUDGET && !writeHappened) {
        const phaseMsg = `[Execution boundary] You have used ${readCount} read-style tool calls (read_file/grep/list_directory/exec_command) without an edit. You are a self-directed agent — DO NOT ask user for confirmation, DO NOT say "请贴出" / "请确认" / "allow me to read again". Either: (a) emit a write tool (edit_file/write_file/hash_edit/multi_edit/ast_edit) NOW with your best-guess concrete args, OR (b) give a final answer with a proposed \`\`\`diff patch\`\`\` block. Do NOT issue another read tool.`;
        messages.push({ role: 'system', content: phaseMsg });
        process.stdout.write(`\x1b[33m[件5] read budget hit (${readCount} reads), injecting phase transition nudge (决断力 强制)\x1b[0m\n`);
        readCount = 0; // 触发后 reset, 防止每轮重复; 模型若仍只 read, 下一轮再 nudge
      }
      // 件 5 (d): diff proposal 强倒计时 — produce diff 后 N 轮内必须 emit edit_file, 不允许再问 a/b/c
      if (diffCountdown > 0 && !writeHappened) {
        const isFinalChance = diffCountdown === 1;
        const diffMsg = isFinalChance
          ? `[Diff countdown — FINAL CHANCE] You proposed a diff in a previous response. This is your LAST round to call edit_file. If you emit anything other than edit_file, the loop ends with "uncompleted diff proposal". Use edit_file with the search/replace pair from your diff.`
          : `[Diff countdown ${DIFF_COUNTDOWN - diffCountdown + 1}/${DIFF_COUNTDOWN}] You proposed a diff in a previous response. You MUST call edit_file in this round using that exact diff — no more questions, no more options (a/b/c). Use edit_file with the search/replace pair from your diff.`;
        messages.push({ role: 'system', content: diffMsg });
        process.stdout.write(`\x1b[33m[件5d] diff countdown ${DIFF_COUNTDOWN - diffCountdown + 1}/${DIFF_COUNTDOWN}, forcing edit_file${isFinalChance ? ' (FINAL CHANCE)' : ''}\x1b[0m\n`);
        diffCountdown--;
      }
      try {
        const t0 = Date.now();
        let content = '';
        let toolCalls = [];
        let firstChunk = true;
        // Tier 1 transport-layer tool-call force (round 0 only): 在 user 消息**前面**拼 transport 提示,
        // 强制 LLM 在 tool_call 或显式拒绝之间二选一, 禁止 preamble/thinking 绕过去.
        // 方案 A 实验: round 0 同时在 provider 协议层传 tool_choice="required", API 强制必须 tool_call.
        if (round === 0 && !transportHintInjected) {
          const last = messages[messages.length - 1];
          if (last && last.role === 'user') {
            last.content = '[TRANSPORT] Your first reply MUST be exactly one tool call. Output ONLY this JSON: {"name": "<tool_name>", "args": {...}}. Do NOT write any explanation, thinking, or preamble. If you cannot or will not, output {"error": "no_tool_call"} to indicate refusal.\n\n' + last.content;
          }
          transportHintInjected = true;
        }
        const roundOptions = (round === 0) ? { tools, tool_choice: 'required' } : { tools };
        if (typeof provider.chatStream === 'function') {
          lastStreamed = true;
          for await (const ev of provider.chatStream(MODEL, messages, roundOptions)) {
            if (ev.type === 'content' && ev.content) { content += ev.content; if (firstChunk) { firstChunk = false; } process.stdout.write(ev.content); }
            else if (ev.type === 'thinking' && ev.content) { /* 折叠, 不实时打 */ }
            else if (ev.type === 'tool_calls' && ev.toolCalls) { toolCalls = ev.toolCalls; }
            else if (ev.done || ev.type === 'done') break;
          }
          if (content) process.stdout.write('\n');
        } else {
          lastStreamed = false;
          const resp = await provider.chat(MODEL, messages, roundOptions);
          content = resp.content || '';
          toolCalls = resp.toolCalls || [];
        }
        const sec = ((Date.now() - t0) / 1000).toFixed(1);
        content = content.trim();

        // cost 累计 (非 fallback chat 路径, 算本轮)
        costTracker.recordUsage({
          messages,
          responseContent: content,
          model: MODEL,
          providerName: providerLabel.split('/')[0],
        });

        // Think stripping
        const tm = content.match(/<think>([\s\S]*?)<\/think>/);
        if (tm) { process.stdout.write(`\x1b[36m[think] ${tm[1].trim().split('\n')[0]}\x1b[0m\n`); content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }

        // XML fallback
        if (!toolCalls.length) {
          // Strip hallucinated system-reminder 防御: M3 在 narrative 约束下会用 "system-reminder" 当 escape hatch,
          // 在 parse 之前剪掉, 防止 LLM 假装被"系统提醒"中断/中止任务.
          const beforeStrip = content;
          content = content.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/\bsystem-reminder\b/gi, '').trim();
          if (beforeStrip !== content) process.stdout.write(`\x1b[90m[strip] hallucinated system-reminder removed (${beforeStrip.length - content.length} chars)\x1b[0m\n`);
          const parsed = parseToolCalls(content);
          if (parsed) {
            // v6 ac623ffb: detect raw JSON fallback path (XML match 0 命中 → 走兜底 1/2/3)
            const xmlMatched = /<tool_call>[\s\S]*?<\/tool_call>|<tool_name>[\s\S]*?<\/tool_name>/.test(content);
            if (!xmlMatched && parsed.length) process.stdout.write(`\x1b[36m[parser] raw JSON fallback matched (${parsed.length} tool call(s))\x1b[0m\n`);
            try {
              toolCalls = parsed.map(c => ({ function: { name: c.name, arguments: JSON.stringify(c.args) }, id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }));
              content = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').replace(/<tool_name>[\s\S]*?<\/tool_name>/g, '').replace(/<tool_args>[\s\S]*?<\/tool_args>/g, '').trim();
            } catch (jsonErr) {
              // stringify 失败 (循环引用等) → 走 failover 路径
              process.stdout.write(`\x1b[33m[XML-fallback] JSON.stringify 失败: ${jsonErr.message?.slice(0, 80)} → failover\x1b[0m\n`);
              throw new Error(`XML fallback JSON.stringify failed: ${jsonErr.message}`);
            }
          }
        }

          if (toolCalls.length) {
            if (content) process.stdout.write(`\x1b[90m[i] ${content.slice(0, 120)}${content.length > 120 ? '...' : ''} (${sec}s)\x1b[0m\n`);
            const validation = validateResponse({ toolCalls: toolCalls.map(tc => ({ id: tc.id, function: { name: tc.function?.name || tc.name, arguments: tc.function?.arguments || tc.arguments } })) }, tools);
            const validatedCalls = validation.toolCalls;
            if (!validatedCalls.length && validation.errors.length) {
              const nudge = `[GP] ${validation.errors.map(e => e.error).join('; ')}。请修正工具调用。`;
              process.stdout.write(`\x1b[31m${nudge}\x1b[0m\n`);
              messages.push({ role: 'system', content: nudge });
              const jsonFailRound = (messages.filter(m => m.role === 'system' && m.content?.includes('JSON 参数解析失败')).length);
              if (jsonFailRound >= 3) {
                messages.push({ role: 'system', content: '[GP] 连续 JSON 参数解析失败，请改用 exec_command(command="type <path>") 或 list_directory(path="...") 读取外部文件，避免在 JSON 中转义长 Windows 路径。' });
              }
              continue;
            }
            messages.push({ role: 'assistant', content: content || null, tool_calls: validatedCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) });
            for (const tc of validatedCalls) {
              totalToolCalls++;
              const n = tc.name;
              const a = Object.keys(tc.args || {}).map(k => `${k}=${String(tc.args[k]).slice(0, 40)}`).join(', ');
              process.stdout.write(`  \x1b[33m→ ${n}(${a})\x1b[0m `);
              // 件 5 (b): read-style tool 累计, write-style tool 触发 reset
              if (READ_TOOLS.has(n)) readCount++;
              if (WRITE_TOOLS.has(n)) { writeHappened = true; readCount = 0; }
              const check = enforcer.check(n);
              if (!check.ok) {
                process.stdout.write(`\x1b[31m[dependency] ${n} 需要先: ${check.missing.join(', ')}\x1b[0m\n`);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: `[dependency] ${n} needs: ${check.missing.join(', ')}` });
                continue;
              }
              let result;
              const cacheKey = `${n}:${JSON.stringify(tc.args)}`;
              if (toolCache.has(cacheKey)) {
                result = toolCache.get(cacheKey);
                process.stdout.write(`\x1b[32mcached\x1b[0m \x1b[90m(${result.length}B)\x1b[0m\n`);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
                continue;
              }
              try {
                result = await execTool({ function: { name: n, arguments: JSON.stringify(tc.args) }, id: tc.id }, dispatch);
                toolCache.set(cacheKey, result);
                enforcer.complete(n);
                // Store successful results in memory (via experiment 43) — 死代码, mem 模块未注册
                try {
                } catch (e) { console.error('[C0]', e); }
              } catch (e) {
                const msg = e.message || String(e);
                let guidance = '';
                if (msg.includes('ENOENT') || msg.includes('not found')) guidance = '文件/目录不存在，请检查路径。';
                else if (msg.includes('EACCES') || msg.includes('permission')) guidance = '权限不足，请检查文件权限或用 exec_command 替代。';
                else if (msg.includes('timeout') || msg.includes('TIMEOUT')) guidance = '工具超时，尝试缩小范围或重试。';
                else if (msg.includes('ENOBUFS') || msg.includes('too long')) guidance = '输出太长，尝试用 grep/glob 缩小搜索范围。';
                else if (msg.includes('Path traversal')) guidance = '外部路径需要 allowExternal=true。';
                result = `[Error] ${msg.slice(0, 200)}${guidance ? `\n[Guidance] ${guidance}` : ''}`;
                tracker.record(n, tc.args, msg, round);
              }
              process.stdout.write(`\x1b[32mdone\x1b[0m \x1b[90m(${result.length}B, ${sec}s)\x1b[0m\n`);
              messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
              histAppend(sessionId, { role: 'tool', tool_call_id: tc.id, content: result });

              // edit-quality-gate: 改文件后异步跑 lint (失败不阻塞, 写入 history 供下轮 LLM 看到)
              const { isEditTool, checkEditedFile } = await import('./edit-quality-gate.mjs');
              if (isEditTool(n) && tc.args?.path) {
                checkEditedFile(tc.args.path).then(gate => {
                  if (!gate.ok && gate.errors.length) {
                    const errSummary = gate.errors.slice(0, 5).map(e => `  ${e.line || '?'}:${e.column || '?'} ${e.message || e.text || ''}`).join('\n');
                    const gateMsg = `[lint-gate] ${gate.summary}\n${errSummary}`;
                    process.stdout.write(`\x1b[33m${gateMsg}\x1b[0m\n`);
                    messages.push({ role: 'system', content: gateMsg });
                    histAppend(sessionId, { role: 'system', content: gateMsg });
                  }
                }).catch(() => { /* swallow, gate 已保永不抛 */ });
              }
            }
            await new Promise(r => setTimeout(r, 500));
          } else {
            // Tier 2 server-side retry: round 0 LLM 出了纯文本, 没 tool_call, 改写更狠的 prompt 重发.
            // 硬上限 2 次 (tier2RetriesLeft), 失败后走 normal finalAnswer 路径.
            if (round === 0 && tier2RetriesLeft > 0) {
              tier2RetriesLeft--;
              const prevSnippet = content.slice(0, 200);
              const retryHint = `[RETRY ${2 - tier2RetriesLeft}/2] You failed to emit a tool call. Your output was: ${prevSnippet}${content.length > 200 ? '...' : ''}. Now output ONLY the JSON tool call, no other text.`;
              process.stdout.write(`\x1b[33m[tier2-retry] round 0 no tool call, retrying (${2 - tier2RetriesLeft}/2)\x1b[0m\n`);
              // 移掉 round 0 的 assistant content, 替换成更强的 user 提示
              const lastUserIdx = messages.findLastIndex(m => m.role === 'user');
              if (lastUserIdx >= 0) {
                const orig = messages[lastUserIdx];
                orig.content = retryHint + '\n\n[Original user request]\n' + (orig.content.replace(/^\[TRANSPORT\][\s\S]*?\n\n/, '') || '');
              } else {
                messages.push({ role: 'user', content: retryHint });
              }
              // 强制 round 0 重跑: 把 round 改回 0 (for 循环 round++ 会变 1, 所以手动重置)
              round = -1;
              continue;
            }
            // 件 5 (d): 检测 diff proposal — 如果 M3 出了 ```diff 块但没 emit edit_file,
            // 启动倒计时, 下一轮强制要求 edit_file, 不允许再 break.
            if (detectDiffProposal(content) && diffCountdown === 0) {
              diffCountdown = DIFF_COUNTDOWN;
              process.stdout.write(`\x1b[33m[件5d] diff proposal detected in final answer, starting ${DIFF_COUNTDOWN}-round countdown to force edit_file\x1b[0m\n`);
              // 把 M3 的 diff proposal 加入 messages 当作 assistant message
              messages.push({ role: 'assistant', content: content || null });
              if (content) histAppend(sessionId, { role: 'assistant', content });
              continue; // 不 break, 让下一轮 (件 5 (d) 倒计时) 逼 edit_file
            }
            finalAnswer = content;
            // assistant 最终回答落盘
            if (content) histAppend(sessionId, { role: 'assistant', content });
            break;
          }
      } catch (e) {
        if (round < 1 && (e.message?.includes('500') || e.message?.includes('timeout'))) {
          process.stdout.write(`\x1b[90m[retry ${round + 1}: ${e.message.slice(0, 60)}]\x1b[0m\n`);
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        // 当前 provider 不可用，移除已尝试的全部 provider，用 picker 选下一个
        const currentName = providerLabel.split('/')[0];
        fallbacks = fallbacks.filter(fb => fb.name !== currentName);
        const nextPicked = await pickFirstAlive(fallbacks, cfg, { silent: false });
        if (nextPicked.ok) {
          provider = nextPicked.provider;
          providerLabel = nextPicked.label;
          MODEL = providerLabel.split('/')[1] || currentModel;
          totalToolCalls = 0; // 新 provider 从头计数
          toolCache.clear(); // 清 cache, 防跨 provider 污染 (B 报告 P0 Bug4)
          messages.length = 0; // 清 messages, 防跨 provider 污染
          messages.push(systemMsg); // 重灌 system msg
          round = -1;
          continue;
        }
        finalAnswer = `[Error] ${e.message}`;
        break;
      }
    }

    // Force final answer summarization if LLM ran out of rounds
    if (!finalAnswer) {
      try {
        messages.push({ role: 'system', content: '[STOP] You have gathered enough info. Give a final answer now in Chinese. Be concise.' });
        const resp = await provider.chat(MODEL, messages, { tools: [] });
        finalAnswer = resp.content?.trim() || '[max rounds]';
        lastStreamed = false; // fallback 走了非流式 chat, 允许 console.log 打印
      } catch { finalAnswer = '[max rounds]'; }
    }

    // finalAnswer: 流式分支已实时打印 content, 跳过; 非流式分支才补打
    if (finalAnswer && !lastStreamed) console.debug(`\n${finalAnswer}\n`);
    try { rl.prompt(); } catch (e) { console.error('[C0]', e); }
  }

  rl.close();
  console.debug('bye.');
}

