// Jzlg 5s pitch analysis — runs Hybrid Fusion on the WAV file
import fs from 'fs';

const SR = 48000;
const HOP = 512; // ~10.7ms per frame

function readWav(path) {
  const buf = fs.readFileSync(path);
  const dataOffset = buf.readUInt32LE(16) + 8; // data sub-chunk offset
  const bits = buf.readUInt16LE(34);
  const bytesPerSample = bits / 8;
  const dataSize = buf.readUInt32LE(40);
  const sampleCount = dataSize / bytesPerSample;
  const samples = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return samples;
}

// YIN
function yinDetect(frame, sr) {
  const frameSize = 2048;
  const minLag = Math.ceil(sr / 2000);
  const maxLag = Math.floor(sr / 40);
  if (frame.length < frameSize) return [];
  const diff = new Float64Array(maxLag + 1);
  for (let tau = 0; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i < frameSize - tau; i++) {
      const d = frame[i] - frame[i + tau];
      s += d * d;
    }
    diff[tau] = s;
  }
  let cumMin = Infinity;
  let threshold = 0.15;
  const cmndf = new Float64Array(maxLag + 1);
  let runningSum = 0;
  cmndf[0] = 1;
  for (let tau = 1; tau <= maxLag; tau++) {
    runningSum += diff[tau];
    cmndf[tau] = runningSum > 0 ? diff[tau] * tau / runningSum : 1;
    if (tau >= minLag && cmndf[tau] < threshold) {
      // Parabolic interpolation
      const a = cmndf[tau - 1], b = cmndf[tau], c = cmndf[tau + 1];
      const denom = a - 2 * b + c;
      let fineTau = tau;
      if (Math.abs(denom) > 1e-12) fineTau = tau + (a - c) / (2 * denom);
      const freq = sr / fineTau;
      const conf = Math.max(0, Math.min(1, 1 - cmndf[tau]));
      return [{ freq: Math.round(freq * 10) / 10, conf: Math.round(conf * 100) / 100 }];
    }
  }
  return [];
}

// PeakTrack
function peakTrackDetect(frame, sr) {
  const frameSize = 2048;
  if (frame.length < frameSize) return [];
  // Simple Hann window + FFT
  const win = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
  const real = new Float64Array(frameSize);
  const imag = new Float64Array(frameSize);
  for (let i = 0; i < frameSize; i++) real[i] = frame[i] * win[i];
  // FFT
  fft(real, imag, frameSize);
  // Magnitude
  const half = frameSize >> 1;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  // Find peaks
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
  if (peaks.length === 0) return [];
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
    const dup = result.some(r => {
      const ratio = c.freq > r.freq ? c.freq / r.freq : r.freq / c.freq;
      return Math.abs(ratio - Math.round(ratio)) < 0.05;
    });
    if (!dup && c.conf > 0.15) {
      result.push({ freq: Math.round(c.freq * 10) / 10, conf: Math.round(c.conf * 100) / 100 });
      if (result.length >= 3) break;
    }
  }
  return result;
}

// Fusion: YIN + PeakTrack
function fusionDetect(frame, sr) {
  const yin = yinDetect(frame, sr);
  const pt = peakTrackDetect(frame, sr);
  // YIN wins if confident, else PeakTrack
  if (yin.length === 0) return pt;
  if (pt.length === 0) return yin;
  if (yin[0].conf > 0.3) return yin;
  return pt;
}

// FFT (Cooley-Tukey in-place)
function fft(real, imag, n) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wlenR = Math.cos(ang), wlenI = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ui = i + j, vi = i + j + len / 2;
        const tr = wr * real[vi] - wi * imag[vi];
        const ti = wr * imag[vi] + wi * real[vi];
        real[vi] = real[ui] - tr; imag[vi] = imag[ui] - ti;
        real[ui] += tr; imag[ui] += ti;
        const twr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR; wr = twr;
      }
    }
  }
}

function midiToNoteName(m) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const oct = Math.floor(m / 12) - 1;
  return names[Math.round(m) % 12] + oct;
}
function freqToMidi(f) { return 12 * Math.log2(f / 440) + 69; }

// --- Main ---
const samples = readWav('jzlg_5s.wav');
const totalFrames = Math.floor((samples.length - 2048) / HOP) + 1;

console.log('=== JzLG 5s — Pitch Analysis ===');
console.log(`File: 48000Hz 16bit mono, ${(samples.length/SR).toFixed(1)}s`);
console.log(`Frame: 2048 samples, hop=${HOP} (${(HOP/SR*1000).toFixed(1)}ms), ${totalFrames} frames`);

// Collect all detections
const detections = [];
for (let fi = 0; fi < totalFrames; fi++) {
  const start = fi * HOP;
  const end = start + 2048;
  if (end > samples.length) break;
  const frame = samples.slice(start, end);
  const det = fusionDetect(frame, SR);
  const time = (start / SR);
  const freq = det.length > 0 ? det[0].freq : 0;
  const conf = det.length > 0 ? det[0].conf : 0;
  const midi = freq > 0 ? freqToMidi(freq) : null;
  const noteName = midi !== null ? midiToNoteName(midi) : '---';
  detections.push({ time, freq, conf, midi, name: noteName });
}

// Piano roll: 1 line per octave, shows note density per time slice
console.log('\nPiano roll (time × octave):');
const OCTAVES = [0, 1, 2, 3, 4, 5, 6];
const TIME_SLICES = 40;
const sliceDur = (samples.length / SR) / TIME_SLICES;
for (const oct of OCTAVES.reverse()) {
  let line = `  Oct ${oct} `;
  for (let si = 0; si < TIME_SLICES; si++) {
    const tStart = si * sliceDur;
    const tEnd = (si + 1) * sliceDur;
    const inSlice = detections.filter(d =>
      d.time >= tStart && d.time < tEnd &&
      d.midi !== null && Math.floor(d.midi / 12) - 1 === oct && d.conf > 0.4
    );
    const unique = new Set(inSlice.map(d => Math.round(d.midi)));
    line += unique.size > 0 ? '█' : '·';
  }
  console.log(line);
}

// Summary: most common notes
console.log('\nMost detected notes (count):');
const noteCounts = {};
for (const d of detections) {
  if (d.conf > 0.4) {
    const rounded = d.midi !== null ? Math.round(d.midi) : -1;
    noteCounts[rounded] = (noteCounts[rounded] || 0) + 1;
  }
}
const sorted = Object.entries(noteCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20);
for (const [midi, count] of sorted) {
  const name = midiToNoteName(Number(midi));
  const dur = (count / totalFrames * (samples.length / SR)).toFixed(2);
  console.log(`  ${name.padEnd(5)} ${String(midi).padStart(5)} MIDI  ${String(count).padStart(4)} frames  ~${dur}s`);
}

// Raw detections (every 5th frame to show trend)
console.log('\nRaw detections (every 5th frame):');
console.log('Time(s)\tFreq(Hz)\tNote\tConf');
for (let i = 0; i < detections.length; i += 5) {
  const d = detections[i];
  console.log(`${d.time.toFixed(2)}\t${d.freq.toFixed(1)}\t${d.name}\t${d.conf.toFixed(2)}`);
}
