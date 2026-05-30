// Compare original jzlg vs codec-encoded — pitch detection consistency
import fs from 'fs';

const SR = 48000;
const HOP = 512;

function readWav(path) {
  const buf = fs.readFileSync(path);
  const dataOffset = buf.readUInt32LE(16) + 8;
  const bits = buf.readUInt16LE(34);
  const bytesPerSample = bits / 8;
  const dataSize = buf.readUInt32LE(40);
  const sampleCount = dataSize / bytesPerSample;
  const samples = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  return samples;
}

function yinDetect(frame, sr) {
  const frameSize = 2048, minLag = Math.ceil(sr / 2000), maxLag = Math.floor(sr / 40);
  if (frame.length < frameSize) return [];
  const diff = new Float64Array(maxLag + 1);
  for (let tau = 0; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < frameSize - tau; i++) { const d = frame[i] - frame[i + tau]; s += d * d; }
    diff[tau] = s;
  }
  let threshold = 0.15;
  const cmndf = new Float64Array(maxLag + 1);
  let runningSum = 0; cmndf[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 0 ? diff[tau] * tau / runningSum : 1;
    if (tau >= minLag && cmndf[tau] < threshold) {
      const a = cmndf[tau - 1], b = cmndf[tau], c = cmndf[tau + 1];
      const denom = a - 2 * b + c;
      let fineTau = tau;
      if (Math.abs(denom) > 1e-12) fineTau = tau + (a - c) / (2 * denom);
      const freq = sr / fineTau;
      const conf = Math.max(0, Math.min(1, 1 - cmndf[tau]));
      return [{ freq: Math.round(freq * 10) / 10, conf: Math.round(conf * 100) / 100 }];
    }
  }
  return [{ freq: 0, conf: 0 }];
}

function peakTrackDetect(frame, sr) {
  const frameSize = 2048;
  if (frame.length < frameSize) return [];
  const win = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
  const real = new Float64Array(frameSize), imag = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) real[i] = frame[i] * win[i];
  fft(real, imag, frameSize);
  const half = frameSize >> 1;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  const peaks = [];
  for (let i = 2; i < half - 2; i++) {
    if (mag[i] > mag[i - 1] && mag[i] > mag[i - 2] && mag[i] > mag[i + 1] && mag[i] > mag[i + 2]) {
      const alpha = mag[i - 1], beta = mag[i], gamma = mag[i + 1];
      const denom = alpha - 2 * beta + gamma;
      let fineIdx = i;
      if (Math.abs(denom) > 1e-12) fineIdx = i + (alpha - gamma) / (2 * denom);
      const freq = fineIdx * sr / frameSize;
      if (freq > 30 && freq < 8000) peaks.push({ idx: fineIdx, freq, amp: mag[i] });
    }
  }
  if (peaks.length === 0) return [{ freq: 0, conf: 0 }];
  peaks.sort((a, b) => b.amp - a.amp);
  const maxAmp = peaks[0].amp;
  const strongPeaks = peaks.filter(p => p.amp > maxAmp * 0.1);
  const candidates = [];
  for (const peak of strongPeaks) {
    let harmonicScore = 0;
    for (let h = 2; h <= 8; h++) {
      const hf = peak.freq * h;
      const m = peaks.find(p => Math.abs(p.freq - hf) / hf < 0.05 && p.amp > peak.amp * 0.05);
      if (m) harmonicScore += m.amp / maxAmp;
    }
    let subHarmonicScore = 0;
    for (let h = 2; h <= 4; h++) {
      const sf = peak.freq / h;
      const m = peaks.find(p => Math.abs(p.freq - sf) / sf < 0.05 && p.amp > peak.amp * 0.2);
      if (m) subHarmonicScore += 1;
    }
    const conf = Math.min(1, (harmonicScore + subHarmonicScore * 0.5) / 3);
    candidates.push({ freq: peak.freq, conf });
  }
  candidates.sort((a, b) => b.conf - a.conf);
  const result = [];
  for (const c of candidates) {
    const dup = result.some(r => { const ratio = c.freq > r.freq ? c.freq / r.freq : r.freq / c.freq; return Math.abs(ratio - Math.round(ratio)) < 0.05; });
    if (!dup && c.conf > 0.15) { result.push({ freq: Math.round(c.freq * 10) / 10, conf: Math.round(c.conf * 100) / 100 }); if (result.length >= 3) break; }
  }
  return result.length > 0 ? result : [{ freq: 0, conf: 0 }];
}

function fusionDetect(frame, sr) {
  const yin = yinDetect(frame, sr);
  const pt = peakTrackDetect(frame, sr);
  if (yin[0].freq === 0) return pt;
  if (pt[0].freq === 0) return yin;
  if (yin[0].conf > 0.3) return yin;
  return pt;
}

function fft(real, imag, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wrL = Math.cos(ang), wiL = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let wr = 1, wi = 0; for (let j = 0; j < len / 2; j++) { const u = i + j, v = i + j + len / 2; const tr = wr * real[v] - wi * imag[v], ti = wr * imag[v] + wi * real[v]; real[v] = real[u] - tr; imag[v] = imag[u] - ti; real[u] += tr; imag[u] += ti; const t = wr * wrL - wi * wiL; wi = wr * wiL + wi * wrL; wr = t; } }
  }
}

function midiToNoteName(m) { const n = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; return n[Math.round(m) % 12] + (Math.floor(Math.round(m) / 12) - 1); }
function freqToMidi(f) { return 12 * Math.log2(f / 440) + 69; }

function analyze(name, samples) {
  const totalFrames = Math.floor((samples.length - 2048) / HOP) + 1;
  const mids = [];
  for (let fi = 0; fi < totalFrames; fi++) {
    const start = fi * HOP;
    const frame = samples.slice(start, start + 2048);
    const det = fusionDetect(frame, SR);
    const freq = det[0].freq;
    const conf = det[0].conf;
    if (freq > 0 && conf > 0.4) {
      mids.push(Math.round(freqToMidi(freq)));
    } else {
      mids.push(null);
    }
  }
  return { name, mids, totalFrames };
}

// --- Main ---
const files = [
  ['Original', 'jzlg_5s.wav'],
  ['Encoded 8765432', 'jzlg_48k_8765432.wav'],
  ['Encoded 6543211', 'jzlg_48k_6543211.wav'],
  ['Encoded dyn_bpc3', 'jzlg_dyn_bpc3.wav'],
];

const results = files.map(([name, path]) => {
  const samples = readWav(path);
  return analyze(name, samples);
});

// Comparison
console.log('=== Original vs Codec — Pitch Detection Comparison ===\n');

// Count agreements and disagreements
const ref = results[0];
for (let i = 1; i < results.length; i++) {
  const cmp = results[i];
  let same = 0, diff = 0, refNull = 0, cmpNull = 0;
  for (let fi = 0; fi < Math.min(ref.mids.length, cmp.mids.length); fi++) {
    if (ref.mids[fi] === null && cmp.mids[fi] === null) continue;
    if (ref.mids[fi] === null) { refNull++; continue; }
    if (cmp.mids[fi] === null) { cmpNull++; continue; }
    if (ref.mids[fi] === cmp.mids[fi]) same++;
    else diff++;
  }
  const total = same + diff + refNull + cmpNull;
  const agreeRate = total > 0 ? (same / (same + diff) * 100).toFixed(1) : 'N/A';
  console.log(`${cmp.name}:`);
  console.log(`  Same note: ${same}/${total} (${agreeRate}%)`);
  console.log(`  Diff note: ${diff}`);
  console.log(`  Orig null: ${refNull} (detected in orig but not in codec)`);
  console.log(`  Codec null: ${cmpNull} (detected in codec but not in orig)`);
  console.log();
}

// Show a timeline comparison for the first result
console.log('Timeline (first 3s, every 2nd frame, O=orig, 8=8765432, 6=6543211, 3=dyn_bpc3):');
console.log('Time\tOrig\t8765432\t6543211\tdyn3');
for (let fi = 0; fi < 60; fi += 2) {
  const time = (fi * HOP / SR).toFixed(2);
  const vals = results.map(r => r.mids[fi] !== null ? midiToNoteName(r.mids[fi]) : '---');
  console.log(`${time}\t${vals[0]}\t${vals[1]}\t${vals[2]}\t${vals[3]}`);
}
