// TDSG-v9：瞬态事件 + 迭代谐波消除（每个扫弦中检测多根弦）
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;
const HOP = Math.round(SR * 0.0053);

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

// HPS: 返回 top-1 基频 + 置信度
function hpsTop1(mag, sr) {
  const hs = new Float64Array(HALF), ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
  for (let i = 0; i < HALF; i++) { let s = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += mag[idx] * ww[h]; } hs[i] = s; }
  const minB = Math.round(HALF * 40 / sr), maxB = Math.round(HALF * 1500 / sr);
  let bestI = minB, bestV = 0;
  for (let i = minB + 1; i < maxB - 1; i++) {
    if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > bestV) { bestV = hs[i]; bestI = i; }
  }
  if (bestV < 1e-10) return null;
  // 对 mag 做 HPS 基值作为 conf：hps 峰 / mag 总能量
  const totalE = mag.reduce((s, v) => s + v, 0);
  const conf = Math.min(1, bestV / Math.max(totalE, 1e-10) * 100);
  const freq = bestI * sr / FFT_SIZE;
  return { freq: Math.round(freq * 10) / 10, conf, bin: bestI };
}

// 衰减指定基频的谐波（×0.05 而非归零，保持残差谱形）
function subtractHarmonics(mag, freq, sr) {
  const r = new Float64Array(mag);
  for (let h = 1; h <= 10; h++) {
    const hf = freq * h;
    if (hf > sr / 2) break;
    const hb = Math.round(hf * FFT_SIZE / sr);
    for (let d = -2; d <= 2; d++) {
      const b = hb + d;
      if (b >= 0 && b < HALF) r[b] *= 0.05;
    }
  }
  return r;
}

function detectTDSG(signal, sr) {
  const tf = Math.floor((signal.length - FFT_SIZE) / HOP) + 1;
  const magBuf = [];

  for (let fi = 0; fi < tf; fi++) {
    const frame = signal.slice(fi * HOP, fi * HOP + FFT_SIZE);
    magBuf.push(computeMag(frame));
  }

  // 频谱通量检测瞬态
  const flux = new Float64Array(tf);
  for (let fi = 1; fi < tf; fi++) {
    let f = 0;
    for (let b = 0; b < HALF; b++) {
      const diff = magBuf[fi][b] - magBuf[fi - 1][b];
      if (diff > 0) f += diff;
    }
    flux[fi] = f;
  }
  const fMean = flux.reduce((s, v) => s + v, 0) / tf;
  const fTh = fMean * 1.5;

  const events = [];
  const fThV9 = fMean * 1.2;
  for (let fi = 3; fi < tf; fi++) {
    if (flux[fi] > fThV9) events.push(fi);
  }

  console.log(`瞬态事件数: ${events.length}`);
  // 每帧只取 1 个最强音。同一扫弦群内相邻帧应覆盖不同弦
  const rawNotes = [];
  for (const fi of events) {
    const r = hpsTop1(magBuf[fi], sr);
    if (r && r.freq >= 40 && r.freq <= 1500 && r.conf >= 0.001) {
      rawNotes.push({ fi, time: fi * HOP / SR, freq: r.freq, midi: f2m(r.freq), conf: r.conf });
    }
  }

  // 帧间去重：25ms 窗口内同音高只保留最高 conf
  rawNotes.sort((a, b) => a.time - b.time);
  const notes = [];
  for (const n of rawNotes) {
    const dup = notes.some(m =>
      Math.abs(m.time - n.time) < 0.025 &&
      Math.abs(m.midi - n.midi) < 2
    );
    if (!dup) notes.push({ ...n, start: n.time, dur: 0.15, instrument: 'guitar' });
  }
  return notes;
}

// === MIDI GT ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;
const T5_START = 200, T5_DUR = 10;
const gt = [];
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, active = {};
  for (const e of track) { tick += e.deltaTime || 0; const sec = tick / ppq * spb; if (sec > T5_START + T5_DUR) break; if (e.type === 'noteOn' && e.velocity > 0) active[e.noteNumber] = { tick, freq: 440 * Math.pow(2, (e.noteNumber - 69) / 12) }; if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) { if (active[e.noteNumber]) { const st = active[e.noteNumber].tick / ppq * spb; const et = tick / ppq * spb; const instr = ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'other'; gt.push({ time: st - T5_START, freq: active[e.noteNumber].freq, midi: 12 * Math.log2(active[e.noteNumber].freq / 440) + 69, dur: et - st, instr }); delete active[e.noteNumber]; } } }
}
const gtG = gt.filter(n => n.instr === 'guitar');

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
const a = 1 - 2 * Math.PI * 200 / SR;
const hp = new Float64Array(mono.length); let y = 0;
for (let i = 1; i < mono.length; i++) { y = mono[i] - mono[i - 1] + a * y; hp[i] = y; }

console.log(`TDSG-v9 谐波消除 (HOP=${HOP})`);
console.log(`GT 吉他: ${gtG.length}`);

const t0 = Date.now();
const det = detectTDSG(hp, SR);
const elapsed = Date.now() - t0;
console.log(`检测音: ${det.length}  ${elapsed}ms`);

let tp = 0, fp = 0, matched = new Set();
for (const d of det) {
  let found = false;
  for (let gi = 0; gi < gtG.length; gi++) {
    if (matched.has(gi)) continue;
    const g = gtG[gi];
    if (Math.abs(d.time - g.time) < 0.15 && Math.abs(d.midi - g.midi) < 1.5) { tp++; matched.add(gi); found = true; break; }
  }
  if (!found) fp++;
}
const fn = gtG.length - matched.size;
const p = tp / (tp + fp) || 0, r = tp / (tp + fn) || 0;
const f1 = 2 * p * r / (p + r || 1) * 100;
console.log(`TP=${tp} FP=${fp} FN=${fn}  Prec=${(p*100).toFixed(1)}% Rec=${(r*100).toFixed(1)}%  F1=${f1.toFixed(1)}%`);

// 按时间分组显示
const groups = {};
for (const d of det) {
  const tkey = Math.round(d.time * 2) / 2;
  if (!groups[tkey]) groups[tkey] = [];
  groups[tkey].push(d);
}
console.log(`\n事件群组（按 0.5s 分桶）：`);
for (const [t, g] of Object.entries(groups).sort((a, b) => a[0] - b[0]).slice(0, 10)) {
  const cl = gtG.filter(gg => Math.abs(gg.time - parseFloat(t)) < 0.3);
  const ms = cl.map(c => `${c.midi.toFixed(0)}(${(c.freq).toFixed(0)})`).join(',');
  console.log(`  ${t}s: ${g.length}音 [${g.map(d => `${d.midi.toFixed(0)}(${(d.freq).toFixed(0)})`).join(',')}]  GT:{${ms}}`);
}
