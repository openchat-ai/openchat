// 实验三全曲版：加州旅馆完整流水线
import fs from 'fs';
import LmdnCodec from '../bridge/src/core/audio/lmdn-codec.mjs';

const SR = 48000, HOP = 1024, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;

function readWavFull(path) {
  const buf = fs.readFileSync(path); let off = 12, dataOff, sr;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(off + 12);
    if (id === 'data') { dataOff = off + 8; break; }
    off += 8 + sz;
  }
  const totalFrames = Math.floor((buf.length - dataOff) / 4);
  const mono = new Float64Array(totalFrames);
  for (let i = 0; i < totalFrames; i++) { const idx = i * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
  return { mono, sr, dur: totalFrames / sr };
}
function writeWav(path, samples, sr) {
  const n = samples.length; const d = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40); fs.writeFileSync(path, Buffer.concat([h, d]));
}

// === DSP ===
const win = new Float64Array(FFT_SIZE); for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function computeMag(s) { const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE); for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i]; fft(re, im, FFT_SIZE); const m = new Float64Array(HALF); for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); return m; }
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
  const len = s.length, maxLag = Math.round(sr / 40), minLag = Math.round(sr / 2000);
  const buf = len < FFT_SIZE ? (() => { const b = new Float64Array(FFT_SIZE); b.set(s); return b; })() : s.slice(0, FFT_SIZE);
  const diff = new Float64Array(maxLag); for (let tau = 0; tau < maxLag; tau++) { let d = 0; for (let i = 0; i < maxLag; i++) { const dd = buf[i] - buf[i + tau]; d += dd * dd; } diff[tau] = d; }
  const cm = new Float64Array(maxLag); cm[0] = 1; let rs = 0; for (let tau = 1; tau < maxLag; tau++) { rs += diff[tau]; cm[tau] = rs > 0 ? diff[tau] * tau / rs : 1; }
  let bl = 0, bv = 1; for (let tau = Math.max(minLag, 2); tau < maxLag; tau++) { if (cm[tau] < cm[tau - 1] && cm[tau] < cm[tau + 1]) { if (cm[tau] < 0.15) { bl = tau; bv = cm[tau]; break; } if (cm[tau] < bv) { bl = tau; bv = cm[tau]; } } }
  if (bl < minLag) return []; let rf = bl; if (bl > 0 && bl < maxLag - 1) { const a = cm[bl - 1], b = cm[bl], g = cm[bl + 1], de = a - 2 * b + g; if (Math.abs(de) > 1e-12) rf = bl + (a - g) / (2 * de); }
  const freq = sr / rf; const cf = Math.max(0, 1 - bv); if (freq > 2000 || freq < 30) return []; return [{ freq: Math.round(freq * 10) / 10, conf: Math.round(cf * 100) / 100 }];
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
  for (const cl of cls) { let wc = 0, tw = 0; const ss = new Set(); for (const note of cl.notes) { const w = ww[note.src] || 0.5; wc += note.conf * w; tw += w; ss.add(note.src); } const ac = tw > 0 ? wc / tw : 0; const bonus = ss.size > 1 ? 0.1 * (ss.size - 1) : 0; r.push({ freq: Math.round(cl.avg * 10) / 10, conf: Math.min(1, ac + bonus) }); }
  r.sort((a, b) => b.conf - a.conf); return r.slice(0, 3);
}

// === Filters ===
function highpass(s, c) { const a = 1 - 2 * Math.PI * c / SR; const o = new Float64Array(s.length); let y = 0; for (let i = 1; i < s.length; i++) { y = s[i] - s[i - 1] + a * y; o[i] = y; } return o; }

// === Detection per channel ===
function detectChannel(signal, offset, minF, maxF, minConf, instrument) {
  const hp = highpass(signal, instrument === 'guitar' ? 200 : 40);
  const sig = instrument === 'bass' ? (() => { const o = new Float64Array(signal.length); let ly = 0; for (let i = 0; i < signal.length; i++) { ly = ly * 0.996 + hp[i] * (1 - 0.996); o[i] = ly; } return o; })() : hp;
  const tf = Math.floor((sig.length - FFT_SIZE) / HOP) + 1;
  const raw = [];
  for (let fi = 0; fi < tf; fi++) {
    const frame = sig.slice(fi * HOP, fi * HOP + FFT_SIZE);
    const dets = fusionDetect(frame, SR);
    for (const d of dets) { if (d.freq > minF && d.freq < maxF && d.conf > minConf) raw.push({ time: offset + fi * HOP / SR, freq: d.freq, midi: f2m(d.freq), conf: d.conf }); }
  }
  const active = {}, notes = [], GAP = 0.05;
  for (const n of raw) { const r = Math.round(n.midi); if (active[r]) { if (n.time - active[r].last > GAP) { const dur = active[r].last - active[r].start; if (dur > 0.04) notes.push({ midi: r, freq: active[r].freqSum / active[r].count, start: active[r].start, dur, conf: active[r].conf, instrument }); active[r] = { freqSum: n.freq, conf: n.conf, start: n.time, last: n.time, count: 1 }; } else { active[r].freqSum += n.freq; active[r].conf = Math.max(active[r].conf, n.conf); active[r].last = n.time; active[r].count++; } } else { active[r] = { freqSum: n.freq, conf: n.conf, start: n.time, last: n.time, count: 1 }; } }
  for (const [r, a] of Object.entries(active)) { const dur = a.last - a.start; if (a.count >= 2 && dur > 0.04) notes.push({ midi: parseInt(r), freq: a.freqSum / a.count, start: a.start, dur, conf: a.conf, instrument }); }
  return notes;
}
function detectDrum(signal, offset, sr) {
  const env = new Float64Array(signal.length); let lpEnv = 0;
  for (let i = 0; i < signal.length; i++) { lpEnv += (Math.abs(signal[i]) - lpEnv) * 0.01; env[i] = lpEnv; }
  const minGap = Math.round(sr * 0.1); const hits = []; let lastHit = -minGap;
  for (let i = minGap; i < signal.length - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > 0.03) {
      const base = env[Math.max(0, i - Math.round(sr * 0.03))];
      if (env[i] > base * 2.2 && i - lastHit > minGap) {
        lastHit = i; const seg = signal.slice(Math.max(0, i - 128), Math.min(signal.length, i + 384));
        let zcr = 0; for (let j = 1; j < seg.length; j++) if (seg[j] * seg[j - 1] < 0) zcr++; zcr /= seg.length;
        const type = zcr < 0.06 ? 'kick' : zcr < 0.18 ? 'snare' : 'hihat';
        hits.push({ time: offset + i / sr, start: offset + i / sr, dur: 0.1, instrument: type, conf: Math.min(1, env[i] / base / 3) });
      }
    }
  }
  return hits;
}

// === Synths ===
function bassSynth(note, durSamples, sr) {
  const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
  const delay = Math.round(sr / freq); if (delay < 4) return new Float64Array(durSamples);
  const vol = 0.2 + Math.min(1, Math.max(0.3, note.conf * 1.2)) * 0.3;
  const out = new Float64Array(durSamples); const buf = new Float64Array(delay);
  for (let i = 0; i < delay; i++) { const noise = (Math.random() * 2 - 1) * 0.2; const pulse = i < delay * 0.3 ? Math.sin(Math.PI * i / delay) * 0.8 : 0; buf[i] = noise + pulse; }
  let wi = 0; const decay = Math.pow(0.9995, 1 / delay); let lp = 0;
  for (let i = 0; i < durSamples; i++) { const s = buf[wi]; const avg = (buf[wi] + buf[(wi - 1 + delay) % delay]) * 0.5; lp = lp * 0.97 + avg * 0.03; buf[wi] = lp * decay; wi = (wi + 1) % delay; const t = i / sr; const env = t < 0.003 ? t / 0.003 : Math.exp(-0.8 * (t - 0.003)); if (env > 0) out[i] = s * env * vol; if (i > sr * 0.1 && env < 0.0001) break; }
  return out;
}
function guitarSynth(note, durSamples, sr) {
  const freq = 440 * Math.pow(2, (note.midi - 69) / 12);
  const delay = Math.round(sr / freq); if (delay < 4) return new Float64Array(durSamples);
  const vol = 0.15 + Math.min(1, Math.max(0.3, note.conf * 1.2)) * 0.25;
  const out = new Float64Array(durSamples); const buf = new Float64Array(delay);
  for (let i = 0; i < delay; i++) { const noise = (Math.random() * 2 - 1) * 0.3; const pulse = i < delay * 0.5 ? Math.sin(Math.PI * i / delay) * 0.7 : 0; buf[i] = noise + pulse; }
  let wi = 0; const decay = Math.pow(0.998, 1 / delay); let lp = 0;
  for (let i = 0; i < durSamples; i++) { const s = buf[wi]; const avg = (buf[wi] + buf[(wi - 1 + delay) % delay]) * 0.5; lp = lp * 0.9 + avg * 0.1; buf[wi] = lp * decay; wi = (wi + 1) % delay; const t = i / sr; const env = t < 0.001 ? t / 0.001 : Math.exp(-1.5 * (t - 0.001)); if (env > 0) out[i] = s * env * vol; if (i > sr * 0.05 && env < 0.0001) break; }
  return out;
}
function drumSynth(note, durSamples, sr) {
  const out = new Float64Array(durSamples);
  for (let i = 0; i < durSamples; i++) { const t = i / sr; let s = 0; if (note.instrument === 'kick') { s = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-20 * t) + (Math.random() * 2 - 1) * 0.3 * Math.exp(-40 * t); } else if (note.instrument === 'snare') { s = Math.sin(2 * Math.PI * 200 * t) * Math.exp(-15 * t) * 0.5 + (Math.random() * 2 - 1) * Math.exp(-12 * t) * 0.6; } else { s = (Math.random() * 2 - 1) * Math.exp(-30 * t) * 0.4; } out[i] = s * 0.5; }
  return out;
}

// ===== Main =====
console.log('='.repeat(60));
console.log('实验三（全曲）：加州旅馆完整流水线');
console.log('='.repeat(60));

const { mono, sr, dur } = readWavFull('jzlg.wav');
const TOTAL_SAMPLES = mono.length;
console.log(`输入: ${dur.toFixed(1)}s (${TOTAL_SAMPLES}样点)`);
writeWav('exp3_full_01_original.wav', mono, SR);

// Step 1: Detect guitar + bass (process in chunks)
console.log(`\n[扒谱] 分通道处理...`);
const CHUNK_SEC = 10;
const totalChunks = Math.ceil(TOTAL_SAMPLES / SR / CHUNK_SEC);
let allGuitar = [], allBass = [], allDrums = [];
const t0 = Date.now();

for (let ci = 0; ci < totalChunks; ci++) {
  const startS = ci * CHUNK_SEC * SR;
  const durS = Math.min(CHUNK_SEC * SR, TOTAL_SAMPLES - startS);
  const chunk = mono.slice(startS, startS + durS);
  const offset = startS / SR;
  process.stdout.write(`\r  Chunk ${ci+1}/${totalChunks} (${offset.toFixed(0)}s)`);
  const g = detectChannel(chunk, offset, 80, 1500, 0.2, 'guitar');
  const b = detectChannel(chunk, offset, 40, 180, 0.15, 'bass');
  const d = detectDrum(chunk, offset, SR);
  allGuitar.push(...g); allBass.push(...b); allDrums.push(...d);
}

const allNotes = [...allGuitar, ...allBass, ...allDrums].sort((a, b) => a.start - b.start);
console.log(`\n  吉他: ${allGuitar.length}, 贝斯: ${allBass.length}, 鼓: ${allDrums.length}, 总计: ${allNotes.length}`);
console.log(`  检测耗时: ${((Date.now()-t0)/1000).toFixed(0)}s`);

// Step 2: LPC-MDCT encode
const t1 = Date.now();
console.log(`\n[编码] lpc-mdct-codec...`);
const codec = new LpcMdctCodec(); await codec.initialize();
const pcmBuf = Buffer.alloc(TOTAL_SAMPLES * 2);
for (let i = 0; i < TOTAL_SAMPLES; i++) pcmBuf.writeInt16LE(Math.round(mono[i] * 32768), i * 2);
const enc = await codec.encode(pcmBuf);
fs.writeFileSync('exp3_full_02_epc.epc', enc.data);
console.log(`  EPC: ${(enc.data.length/1024/1024).toFixed(1)}MB (${(TOTAL_SAMPLES*2/enc.data.length).toFixed(1)}x)  ${((Date.now()-t1)/1000).toFixed(0)}s`);

// Step 3: Decode
const t2 = Date.now();
console.log(`[解码] EPC → PCM...`);
const dec = await codec.decode(enc.data);
const reconSamples = Math.floor(dec.pcm.length / 2);
const recon = new Float64Array(reconSamples);
for (let i = 0; i < reconSamples; i++) recon[i] = dec.pcm.readInt16LE(i * 2) / 32768;
writeWav('exp3_full_03_decoded.wav', recon, SR);
console.log(`  PCM: ${(reconSamples/SR).toFixed(1)}s  ${((Date.now()-t2)/1000).toFixed(0)}s`);

// Step 4: Synthesize
const t3 = Date.now();
console.log(`[合成] ${allNotes.length} 声部...`);
const synthLen = Math.min(recon.length, TOTAL_SAMPLES);
const synth = new Float64Array(synthLen);
let synthCount = 0;
for (const n of allNotes) {
  const startS = Math.round((n.start || n.time) * SR);
  const durS = Math.max(Math.round((n.dur || 0.1) * SR), Math.round(SR * 0.03));
  if (startS + durS > synthLen) continue;
  const fn = n.instrument === 'bass' ? bassSynth : n.instrument === 'guitar' ? guitarSynth : drumSynth;
  const tone = fn(n, durS, SR);
  for (let i = 0; i < durS; i++) synth[startS + i] += tone[i];
  synthCount++;
  if (synthCount % 1000 === 0) process.stdout.write(`.`);
}
writeWav('exp3_full_04_synth.wav', synth, SR);
console.log(`\n  合成: ${synthCount}/${allNotes.length}  ${((Date.now()-t3)/1000).toFixed(0)}s`);

// Step 5: Mix
const t4 = Date.now();
console.log(`[混合] PCM + 合成...`);
const mixLen = Math.min(recon.length, synth.length);
const mix = new Float64Array(mixLen);
for (let i = 0; i < mixLen; i++) mix[i] = synth[i] + recon[i] * 0.3;
writeWav('exp3_full_05_mix.wav', mix, SR);
console.log(`  ${((Date.now()-t4)/1000).toFixed(0)}s`);

console.log(`\n--- 结果 ---`);
console.log(`01: exp3_full_01_original.wav  原始 (${(TOTAL_SAMPLES*2/1024/1024).toFixed(1)}MB)`);
console.log(`02: exp3_full_02_epc.epc      EPC (${(enc.data.length/1024/1024).toFixed(1)}MB)`);
console.log(`03: exp3_full_03_decoded.wav  解码 (${(reconSamples*2/1024/1024).toFixed(1)}MB)`);
console.log(`04: exp3_full_04_synth.wav    合成 (${(synth.length*2/1024/1024).toFixed(1)}MB)`);
console.log(`05: exp3_full_05_mix.wav      混合 (${(mix.length*2/1024/1024).toFixed(1)}MB)`);
console.log(`总耗时: ${((Date.now()-t0)/1000/60).toFixed(1)}min`);
