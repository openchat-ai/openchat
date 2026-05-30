import fs from 'fs';
import { NeuralAudioCodec } from '../bridge/src/core/audio/neural-audio-codec.js';

const SR = 48000, HOP = 1024;

function readWav(path) {
  const buf = fs.readFileSync(path);
  let off = 12, sr, bits, ch, dataOff, frames;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { sr = buf.readUInt32LE(off + 12); ch = buf.readUInt16LE(off + 10); bits = buf.readUInt16LE(off + 22); }
    if (id === 'data') { dataOff = off + 8; frames = sz / (bits / 8) / ch; break; }
    off += 8 + sz;
  }
  const bps = bits / 8, mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < ch; c++) s += buf.readInt16LE(dataOff + (i * ch + c) * 2); mono[i] = s / ch / 32768; }
  return mono;
}
function writeWav(path, samples) {
  const n = samples.length; const d = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(path, Buffer.concat([h, d]));
}

// Pitch detection (Fusion)
function yinDetect(frame, sr) {
  const fs = 2048, mL = Math.ceil(sr / 2000), ML = Math.floor(sr / 40);
  if (frame.length < fs) return [];
  const d = new Float64Array(ML + 1);
  for (let t = 0; t <= ML; t++) { let s = 0; for (let i = 0; i < fs - t; i++) { const dd = frame[i] - frame[i + t]; s += dd * dd; } d[t] = s; }
  const c = new Float64Array(ML + 1); c[0] = 1; let rs = 0;
  for (let t = 1; t <= ML; t++) { rs += d[t]; c[t] = rs > 0 ? d[t] * t / rs : 1; if (t >= mL && c[t] < 0.15) { const a = c[t - 1], b = c[t], cc = c[t + 1]; const de = a - 2 * b + cc; const ft = Math.abs(de) > 1e-12 ? t + (a - cc) / (2 * de) : t; return [{ freq: sr / ft, conf: Math.max(0, 1 - c[t]) }]; } }
  return [];
}
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function peakTrackDetect(frame, sr) {
  const fs = 2048; if (frame.length < fs) return [];
  const win = new Float64Array(fs); for (let i = 0; i < fs; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fs - 1)));
  const re = new Float64Array(fs), im = new Float64Array(fs);
  for (let i = 0; i < fs; i++) re[i] = frame[i] * win[i];
  fft(re, im, fs); const half = fs >> 1; const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  const peaks = [];
  for (let i = 2; i < half - 2; i++) {
    if (mag[i] > mag[i - 1] && mag[i] > mag[i - 2] && mag[i] > mag[i + 1] && mag[i] > mag[i + 2]) {
      const a = mag[i - 1], b = mag[i], g = mag[i + 1], de = a - 2 * b + g;
      let fi = i; if (Math.abs(de) > 1e-12) fi = i + (a - g) / (2 * de);
      const f = fi * sr / fs; if (f > 30 && f < 8000) peaks.push({ idx: fi, freq: f, amp: mag[i] });
    }
  }
  if (!peaks.length) return [];
  peaks.sort((a, b) => b.amp - a.amp); const maxA = peaks[0].amp;
  const strong = peaks.filter(p => p.amp > maxA * 0.05); const cands = [];
  for (const p of strong) { let hs = 0; for (let h = 2; h <= 8; h++) { const hf = p.freq * h; const m = peaks.find(pp => Math.abs(pp.freq - hf) / hf < 0.06 && pp.amp > p.amp * 0.03); if (m) hs += m.amp / maxA; } let sh = 0; for (let h = 2; h <= 6; h++) { const sf = p.freq / h; const m = peaks.find(pp => Math.abs(pp.freq - sf) / sf < 0.06 && pp.amp > p.amp * 0.15); if (m) sh++; } const conf = Math.min(1, (hs + sh * 0.5) / 3); cands.push({ freq: p.freq, conf }); }
  cands.sort((a, b) => b.conf - a.conf); const res = [];
  for (const c of cands) { const dup = res.some(r => { const ratio = c.freq > r.freq ? c.freq / r.freq : r.freq / c.freq; return Math.abs(ratio - Math.round(ratio)) < 0.05; }); if (!dup && c.conf > 0.15) { res.push({ freq: Math.round(c.freq * 10) / 10, conf: Math.round(c.conf * 100) / 100 }); if (res.length >= 3) break; } }
  return res;
}
function hybridFuse(yin, pt) {
  if (!yin || !yin.length) return pt && pt.length ? pt[0] : null;
  if (!pt || !pt.length) return yin[0];
  if (yin[0].conf > 0.5) return yin[0];
  const lo = Math.min(yin[0].freq, pt[0].freq), hi = Math.max(yin[0].freq, pt[0].freq);
  const ratio = hi / lo, rounded = Math.round(ratio), error = Math.abs(ratio - rounded);
  const allowed = error < 0.05 || pt[0].freq / yin[0].freq >= 2;
  if (allowed) return { freq: yin[0].freq, conf: (yin[0].conf + pt[0].conf) / 2 };
  return yin[0].conf >= pt[0].conf ? yin[0] : pt[0];
}
function midiName(m) { const n = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; const r = Math.round(m); return n[r % 12] + (Math.floor(r / 12) - 1); }
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }

function detectFusion(samples) {
  const frames = Math.floor((samples.length - 2048) / HOP) + 1;
  let det = 0; const notes = {};
  for (let fi = 0; fi < frames; fi++) {
    const start = fi * HOP; const frame = samples.slice(start, start + 2048);
    const y = yinDetect(frame, SR); const pt = peakTrackDetect(frame, SR); const f = hybridFuse(y, pt);
    if (f) { det++; const m = Math.round(f2m(f.freq)); notes[m] = (notes[m] || 0) + 1; }
  }
  const top = Object.entries(notes).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { rate: (det / frames * 100).toFixed(1), det, frames, top: top.map(([m, c]) => midiName(Number(m)) + '(' + c + 'f)').join(' ') };
}

// ===== Main Pipeline =====
console.log('='.repeat(70));
console.log('PIPELINE: Original → NeuralAudioCodec Encode → Decode → Detect');
console.log('='.repeat(70));

const wav48 = readWav('jzlg_5s.wav');
console.log(`\nOriginal: 5s @ ${SR}Hz = ${(wav48.length * 2 / 1024).toFixed(0)}KB PCM`);

async function run() {
  const sr = 24000; // codec native rate
  const codec = new NeuralAudioCodec({ sampleRate: sr, frameSize: 20 });
  await codec.initialize();

  const ratio = SR / sr;
  const mono24 = new Float64Array(Math.floor(wav48.length / ratio));
  for (let i = 0; i < mono24.length; i++) { let s = 0; for (let j = 0; j < ratio; j++) s += wav48[i * ratio + j] || 0; mono24[i] = s / ratio; }

  // Original Fusion
  console.log(`\n[Fusion on Original @ ${SR}Hz]`);
  const origDet = detectFusion(wav48);
  console.log(`  ${origDet.rate}% (${origDet.det}/${origDet.frames})  ${origDet.top}`);

  // Encode → decode at various quantization levels, write files
  const qLevels = [8, 6, 4, 3];
  for (const q of qLevels) {
    const pcm = Buffer.alloc(mono24.length * 2);
    for (let i = 0; i < mono24.length; i++) pcm.writeInt16LE(Math.round(mono24[i] * 32768), i * 2);

    const t0 = Date.now();
    codec.config.quantizationBits = q;
    const enc = await codec.encode(pcm);
    const dec = await codec.decode(enc.data);
    const dt = Date.now() - t0;

    // Write EPC file
    fs.writeFileSync(`pipeline_${q}bit.epc`, enc.data);

    // Write decoded WAV (upsample to 48kHz)
    const outSamples = dec.pcm.length / 2;
    const upsampled = new Float64Array(outSamples * ratio);
    for (let i = 0; i < outSamples; i++) { const v = dec.pcm.readInt16LE(i * 2) / 32768; for (let j = 0; j < ratio; j++) upsampled[i * ratio + j] = v; }
    writeWav(`pipeline_${q}bit.wav`, upsampled);

    const det = detectFusion(upsampled);
    const epcSize = enc.data.length;
    const ratioStr = (pcm.length / epcSize).toFixed(1);
    console.log(`\n[${q}-bit NeuralCodec] ${dt}ms  EPC=${(epcSize / 1024).toFixed(1)}KB  CR=${ratioStr}x`);
    console.log(`  ${det.rate}% (${det.det}/${det.frames})  ${det.top}`);
  }

  // File counts
  const allFiles = fs.readdirSync('.');
  const wavs = allFiles.filter(f => f.endsWith('.wav') && f.startsWith('jzlg'));
  const epcs = allFiles.filter(f => f.endsWith('.epc') && f.startsWith('jzlg'));
  const pwavs = allFiles.filter(f => f.endsWith('.wav') && f.startsWith('pipeline_'));
  const pepcs = allFiles.filter(f => f.endsWith('.epc') && f.startsWith('pipeline_'));
  console.log(`\n--- Generated Files ---`);
  console.log(`pipeline_*.wav: ${pwavs.join(', ')} (${pwavs.length})`);
  console.log(`pipeline_*.epc: ${pepcs.join(', ')} (${pepcs.length})`);
  console.log(`jzlg_*.wav: ${wavs.length}, jzlg_*.epc: ${epcs.length}`);
}
run().catch(e => console.error('ERR:', e.message));
