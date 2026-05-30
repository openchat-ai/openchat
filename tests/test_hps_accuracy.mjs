import fs from 'fs';

// ===== HPS Multi-F0 Detection (ported from Dart) =====
const FFT_SIZE = 2048;
const HALF = FFT_SIZE >> 1;

// Precompute window
const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const w = ang * j, wr = Math.cos(w), wi = -Math.sin(w);
        const u = re[i + j], v = im[i + j];
        const dr = re[i + j + len / 2], di = im[i + j + len / 2];
        re[i + j] = u + dr * wr - di * wi;
        im[i + j] = v + dr * wi + di * wr;
        re[i + j + len / 2] = u - (dr * wr - di * wi);
        im[i + j + len / 2] = v - (dr * wi + di * wr);
      }
    }
  }
}

function hpsMultiF0(samples, sr = 48000) {
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  const copyLen = Math.min(FFT_SIZE, samples.length);
  for (let i = 0; i < copyLen; i++) re[i] = samples[i] * win[i];

  fft(re, im);

  // Magnitude
  const mag = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);

  // HPS: product of 4 downsampled spectra
  const hp = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) {
    let p = mag[i];
    if (p < 1) { hp[i] = 0; continue; }
    for (let h = 2; h <= 4; h++) {
      const idx = Math.round(i * h);
      if (idx >= HALF) break;
      p *= mag[idx];
    }
    hp[i] = p;
  }

  // Find peaks in 40-1500Hz range
  const minBin = Math.round(HALF * 40 / sr);
  const maxBin = Math.round(HALF * 1500 / sr);
  const peaks = [];
  let maxPeakVal = 0;
  for (let i = minBin + 1; i < maxBin - 1; i++) {
    if (hp[i] > hp[i - 1] && hp[i] > hp[i + 1] && hp[i] > 0) {
      peaks.push({ idx: i, val: hp[i] });
      if (hp[i] > maxPeakVal) maxPeakVal = hp[i];
    }
  }

  const threshold = maxPeakVal * 0.2;
  const filtered = peaks.filter(p => p.val >= threshold);
  filtered.sort((a, b) => b.val - a.val);

  const result = [];
  for (const p of filtered) {
    const freq = p.idx * sr / FFT_SIZE;
    const dup = result.some(r => {
      const ratio = freq > r.freq ? freq / r.freq : r.freq / freq;
      return Math.abs(ratio - Math.round(ratio)) < 0.08;
    });
    if (!dup) {
      let corr = p.val / maxPeakVal;
      if (corr > 1) corr = 1;
      const midi = 12 * Math.log2(freq / 440) + 69;
      result.push({ freq: Math.round(freq * 10) / 10, midi: Math.round(midi * 100) / 100, corr: Math.round(corr * 100) / 100, conf: Math.round(p.val / peaks[0].val * 100) / 100 });
      if (result.length >= 2) break;
    }
  }
  return result;
}

// ===== Test: Generate synthetic audio =====
function generateNote(freq, sr, dur, harm = [1, 0.5, 0.3, 0.2, 0.1]) {
  const n = Math.round(sr * dur);
  const buf = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    for (let h = 0; h < harm.length; h++) {
      s += harm[h] * Math.sin(2 * Math.PI * freq * (h + 1) * t);
    }
    // Apply envelope (attack + decay)
    const env = t < 0.01 ? t / 0.01 : Math.exp(-(t - 0.01) * 5);
    buf[i] = s * env * 0.5;
  }
  return buf;
}

function freqToMidi(freq) { return 12 * Math.log2(freq / 440) + 69; }
function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

// ===== Tests =====
console.log('=== 阶段二：HPS 扒谱精度测试 ===\n');

const testCases = [
  { name: 'A4 (440Hz)', harm: [1, 0.5, 0.3, 0.15, 0.08] },
  { name: 'C4 (261.6Hz)', harm: [1, 0.7, 0.4, 0.2, 0.1] },
  { name: 'C5 (523.3Hz)', harm: [1, 0.4, 0.2, 0.1, 0.05] },
  { name: 'G2 (98Hz) 低音', harm: [1, 0.6, 0.4, 0.3, 0.2] },
  { name: 'E6 (1318.5Hz) 高音', harm: [1, 0.3, 0.1, 0.05, 0.02] },
  { name: 'A0 (27.5Hz) 极低音', harm: [1, 0.8, 0.5, 0.3, 0.1] },
  { name: 'C7 (2093Hz) 超高', harm: [1, 0.3, 0.1, 0.05, 0.02] },
];

let passed = 0, failed = 0;
for (const tc of testCases) {
  const freq = parseFloat(tc.name.match(/\(([\d.]+)Hz/)[1]);
  const expectedMidi = freqToMidi(freq);
  const buf = generateNote(freq, 48000, 0.5, tc.harm);
  const result = hpsMultiF0(buf, 48000);

  if (result.length > 0) {
    const detMidi = result[0].midi;
    const err = Math.abs(detMidi - expectedMidi);
    if (err < 0.5) {
      console.log(`✓ ${tc.name}: 检出 ${result[0].freq}Hz (midi=${result[0].midi}) 误差=${err.toFixed(2)} 半音 置信=${result[0].conf}`);
      passed++;
    } else {
      console.log(`✗ ${tc.name}: 检出 ${result[0].freq}Hz → midi=${detMidi} 期望=${expectedMidi.toFixed(1)} 误差=${err.toFixed(1)}半音`);
      failed++;
    }
  } else {
    console.log(`✗ ${tc.name}: 未检出音高`);
    failed++;
  }
  // If 2 notes detected, show second
  if (result.length > 1) {
    console.log(`   第二音: ${result[1].freq}Hz midi=${result[1].midi} 置信=${result[1].conf}`);
  }
}
console.log(`\n单音测试: ${passed}/${testCases.length} 通过`);
console.log('');

// ===== Chord tests =====
console.log('=== 和弦测试 ===');
const chords = [
  { name: '大三 C4+E4+G4', notes: [261.63, 329.63, 392.00] },
  { name: '大六 C4+E4+A4', notes: [261.63, 329.63, 440.00] },
  { name: '不和 E4+F4', notes: [329.63, 349.23] },
  { name: '八度 C4+C5', notes: [261.63, 523.25] },
];

let chordPass = 0, chordFail = 0;
for (const ch of chords) {
  // Mix all notes
  const len = Math.round(48000 * 0.5);
  const buf = new Float64Array(len);
  for (const f of ch.notes) {
    const n = generateNote(f, 48000, 0.5);
    for (let i = 0; i < len; i++) buf[i] += n[i];
  }
  const result = hpsMultiF0(buf, 48000);
  const detFreqs = result.map(r => r.freq);

  console.log(`\n${ch.name}: 期望 ${ch.notes.map(f=>f.toFixed(1)+'Hz').join(', ')}`);
  console.log(`  检出 ${detFreqs.length > 0 ? detFreqs.join('Hz, ')+'Hz' : '无'}`);
  if (result.length > 0) result.forEach(r => console.log(`    midi=${r.midi} 置信=${r.conf}`));
}
