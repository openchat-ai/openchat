// Compare 48kHz (LpcMdct) vs 24kHz (Skeleton) codecs on same audio
import fs from 'fs';
import LpcMdctCodec from '../bridge/src/core/audio/lpc-mdct-codec.js';
import { SkeletonCodec } from '../apps/bridge/skeleton-codec.mjs';

function readWav(path) {
  const buf = fs.readFileSync(path); let off = 12, dataOff, sr;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(off + 12);
    if (id === 'data') { dataOff = off + 8; break; }
    off += 8 + sz;
  }
  const samples = Math.floor((buf.length - dataOff) / 2);
  const pcm = new Float64Array(samples);
  for (let i = 0; i < samples; i++) pcm[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  return { pcm, sr, dur: samples / sr };
}

function writeWav(path, samples, sr) {
  const n = samples.length; const d = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) d.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + n * 2, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(n * 2, 40); fs.writeFileSync(path, Buffer.concat([h, d]));
}

function downsample(src, fromSr, toSr) {
  if (fromSr === toSr) return src;
  const ratio = toSr / fromSr;
  const outLen = Math.round(src.length * ratio);
  const out = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio;
    const si = Math.floor(srcIdx);
    const frac = srcIdx - si;
    out[i] = si + 1 < src.length
      ? src[si] * (1 - frac) + src[si + 1] * frac
      : src[Math.min(si, src.length - 1)];
  }
  return out;
}

function calcSnr(orig, recon) {
  const len = Math.min(orig.length, recon.length);
  let sig = 0, noise = 0;
  for (let i = 0; i < len; i++) {
    sig += orig[i] * orig[i];
    const d = orig[i] - recon[i];
    noise += d * d;
  }
  if (noise < 1e-20) return 999;
  return 10 * Math.log10(sig / noise);
}

// Load original audio (48kHz)
const orig = readWav('jzlg.wav');
const ss = Math.round(200 * orig.sr);  // 200s offset
const dd = Math.round(10 * orig.sr);   // 10s duration
const seg = orig.pcm.slice(ss, ss + dd);
console.log(`原始: ${orig.sr}Hz, ${seg.length} samples (${(seg.length/orig.sr).toFixed(1)}s)`);

// 1. Encode with 48kHz LpcMdctCodec
console.log('\n[1/3] 48kHz LpcMdctCodec...');
const codec48 = new LpcMdctCodec(); await codec48.initialize();
const pcmBuf48 = Buffer.alloc(seg.length * 2);
for (let i = 0; i < seg.length; i++) pcmBuf48.writeInt16LE(Math.round(seg[i] * 32768), i * 2);
const enc48 = await codec48.encode(pcmBuf48);
const dec48 = await codec48.decode(enc48.data);
const recon48 = new Float64Array(dec48.pcm.length / 2);
for (let i = 0; i < recon48.length; i++) recon48[i] = dec48.pcm.readInt16LE(i * 2) / 32768;
const snr48 = calcSnr(seg, recon48);
console.log(`  压缩: ${(enc48.data.length/1024).toFixed(0)}KB (${(seg.length*2/enc48.data.length).toFixed(1)}x)`);
console.log(`  SNR: ${snr48.toFixed(2)} dB`);

// 2. Encode with 24kHz SkeletonCodec (downsample first)
console.log('\n[2/3] 24kHz SkeletonCodec...');
const seg24 = downsample(seg, orig.sr, 24000);
const codec24 = new SkeletonCodec(); await codec24.initialize();
const pcmBuf24 = Buffer.alloc(seg24.length * 2);
for (let i = 0; i < seg24.length; i++) pcmBuf24.writeInt16LE(Math.round(seg24[i] * 32768), i * 2);
const enc24 = await codec24.encode(pcmBuf24);
const dec24res = await codec24.decode(enc24.data);
const dec24buf = dec24res.pcm;
const recon24raw = new Float64Array(dec24buf.length / 2);
for (let i = 0; i < recon24raw.length; i++) recon24raw[i] = dec24buf.readInt16LE(i * 2) / 32768;
const snr24 = calcSnr(seg24, recon24raw);
console.log(`  压缩: ${(enc24.data.length/1024).toFixed(0)}KB (${(seg24.length*2/enc24.data.length).toFixed(1)}x)`);
console.log(`  SNR: ${snr24.toFixed(2)} dB`);

// 3. Compare noise floor
const noiseFloor48 = new Float64Array(recon48.length);
for (let i = 0; i < recon48.length; i++) noiseFloor48[i] = seg[i] - (i < recon48.length ? recon48[i] : 0);
writeWav('compare_48_noise.wav', noiseFloor48, orig.sr);

const noiseFloor24 = new Float64Array(recon24raw.length);
for (let i = 0; i < recon24raw.length; i++) noiseFloor24[i] = seg24[i] - (i < recon24raw.length ? recon24raw[i] : 0);
writeWav('compare_24_noise.wav', noiseFloor24, 24000);

// Write comparison
console.log('\n[3/3] Coeff stats (noise floor):');
function noiseStats(noise, label) {
  let avg = 0, peak = 0;
  for (let i = 0; i < noise.length; i++) { const a = Math.abs(noise[i]); avg += a; if (a > peak) peak = a; }
  avg /= noise.length;
  // FFT analysis: which bins have most noise
  const binLen = 256;
  const noisSp = new Array(binLen).fill(0);
  const hop = 128; let cnt = 0;
  for (let fi = 0; fi + binLen < noise.length; fi += hop) {
    for (let i = 0; i < binLen; i++) {
      const k = Math.round((orig.sr === 48000 ? i : i * 48000 / 24000) * binLen / orig.sr);
      if (k < binLen) noisSp[Math.min(k, binLen-1)] += Math.abs(noise[fi + i]);
    }
    cnt++;
  }
  for (let i = 0; i < binLen; i++) noisSp[i] /= cnt;
  console.log(`  ${label}: avg=${(avg*1e5).toFixed(1)}e-5 peak=${(peak*1e5).toFixed(1)}e-5`);
  const zerobands = [];
  for (let b = 0; b < 16; b++) {
    const st = Math.round(b * binLen / 16), en = Math.round((b + 1) * binLen / 16);
    let e = 0; for (let k = st; k < en; k++) e += noisSp[k];
    if (e < 1e-8) zerobands.push(b);
  }
  if (zerobands.length > 0) console.log(`  ${label} zeroed bands: ${zerobands.join(',')} (approx ${Math.round(zerobands[0]*7.5)}-${Math.round((zerobands[zerobands.length-1]+1)*7.5)}kHz)`);
}
noiseStats(noiseFloor48, '48kHz');
noiseStats(noiseFloor24, '24kHz');

console.log('\n文件输出: compare_48_noise.wav, compare_24_noise.wav');
process.exit(0);
