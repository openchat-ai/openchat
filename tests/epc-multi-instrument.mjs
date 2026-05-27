// EPC Multi-Instrument Test: Erhu (Sai Ma) + Piano (Xiao Mi Feng)
import { writeFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ===== Codebook (copy from epc-roundtrip.mjs) =====
const NOTES = 128, VELS = 32, ENTRIES = NOTES * VELS, HARMS = 8;
const codebook = [];
for (let idx = 0; idx < ENTRIES; idx++) {
  const midiNote = Math.floor(idx / VELS);
  const vel = idx % VELS;
  const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
  const bright = vel / (VELS - 1);
  let decay = freq / 2000 + (1 - bright) * 0.3;
  decay = Math.max(0.05, Math.min(2.0, decay));
  const h = [];
  for (let hh = 0; hh < HARMS; hh++) h.push(Math.round(Math.max(0, Math.min(255, Math.exp(-hh * decay) * (1 + bright * 0.5) * 255))));
  codebook.push(h);
}
function findNearest(target) {
  let best = 0, bestDist = Infinity;
  for (let i = 0; i < ENTRIES; i++) {
    let d = 0;
    for (let h = 0; h < HARMS; h++) { const dd = codebook[i][h] - target[h]; d += dd * dd; }
    if (d < bestDist) { bestDist = d; best = i; if (d === 0) break; }
  }
  return best;
}

// ===== FFT + HPS (same as before) =====
function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len;
    const wR = Math.cos(ang), wI = -Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cR = 1, cI = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j], uI = imag[i + j];
        const vR = real[i + j + len / 2] * cR - imag[i + j + len / 2] * cI;
        const vI = real[i + j + len / 2] * cI + imag[i + j + len / 2] * cR;
        real[i + j] = uR + vR; imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR; imag[i + j + len / 2] = uI - vI;
        const tR = cR * wR - cI * wI;
        cI = cR * wI + cI * wR; cR = tR;
      }
    }
  }
}

function hpsMultiF0(samples, sr) {
  const n = 2048;
  const halfN = n >> 1;
  const real = new Float64Array(n), imag = new Float64Array(n);
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  for (let i = 0; i < n && i < samples.length; i++) { real[i] = samples[i] * win[i]; imag[i] = 0; }
  for (let i = samples.length; i < n; i++) real[i] = 0;
  fft(real, imag);
  const mag = new Float64Array(halfN);
  for (let i = 0; i < halfN; i++) mag[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  const hps = new Float64Array(halfN);
  for (let i = 0; i < halfN; i++) {
    let p = mag[i]; if (p < 1) continue;
    for (let h = 2; h <= 4; h++) { const idx = Math.round(i * h); if (idx >= halfN) break; p *= mag[idx]; }
    hps[i] = p;
  }
  const minBin = Math.round(halfN * 40 / sr), maxBin = Math.round(halfN * 1500 / sr);
  const peaks = [];
  for (let i = minBin + 1; i < maxBin - 1; i++) {
    if (hps[i] > hps[i - 1] && hps[i] > hps[i + 1] && hps[i] > 0) peaks.push({ bin: i, val: hps[i], freq: i * sr / n });
  }
  peaks.sort((a, b) => b.val - a.val);
  const result = [];
  for (const p of peaks) {
    const dup = result.some(r => { const rt = p.freq > r.freq ? p.freq / r.freq : r.freq / p.freq; return Math.abs(rt - Math.round(rt)) < 0.08; });
    if (!dup) { result.push({ freq: p.freq, corr: Math.min(1, p.val / (peaks[0]?.val || 1)) }); if (result.length >= 2) break; }
  }
  return result;
}

function analyzeWindow(samples, sr) {
  const tones = []; const n = samples.length;
  const candidates = n >= 2048 ? hpsMultiF0(samples, sr) : (() => { const ml = Math.floor(sr / 1500); for (let l = Math.floor(sr / 1500); l <= Math.floor(sr / 40); l++) { let c = 0, no = 0; const hf = n >> 1; for (let i = 0; i < hf; i++) { c += samples[i] * samples[i + l]; no += samples[i] * samples[i] + samples[i + l] * samples[i + l]; } const cr = no > 0 ? c / Math.sqrt(no) : 0; if (cr > 0.4) return [{ freq: sr / l, corr: cr }]; } return []; })();
  for (const p of candidates) {
    const f0 = p.freq; const raw = [];
    for (let h = 0; h < 8; h++) {
      const hz = f0 * (h + 1); const bin = Math.round(hz * n / sr);
      if (bin < 1 || bin >= n / 2) { raw.push(0); continue; }
      let cR = 0, cI = 0;
      for (let i = 0; i < Math.min(samples.length, n); i++) { const a = 2 * Math.PI * bin * i / n; cR += samples[i] * Math.cos(a); cI -= samples[i] * Math.sin(a); }
      raw.push(Math.sqrt(cR * cR + cI * cI) / Math.min(samples.length, n) * 2);
    }
    const maxH = Math.max(...raw, 1);
    const harms = raw.map(a => Math.round(Math.max(0, Math.min(255, a / maxH * 255))));
    const sigRms = Math.sqrt(samples.slice(0, Math.min(480, samples.length)).reduce((s, v) => s + v * v, 0) / Math.min(480, samples.length));
    tones.push({ f0, confidence: p.corr, harmonics: harms, rms: Math.round(Math.min(255, sigRms / 32768 * 255)) });
  }
  return tones;
}

function quickCheck(s, lag, half) { let c = 0, n = 0; for (let i = 0; i < half; i++) { c += s[i] * s[i + lag]; n += s[i] * s[i] + s[i + lag] * s[i + lag]; } return n > 0 ? c / Math.sqrt(n) : 0; }

// ===== EPC Pack/Unpack =====
function packEpc(tag) {
  const b = Buffer.alloc(12);
  b[0] = 0x02; b[1] = (tag.trackId << 4) & 0xF0;
  b[2] = (tag.codebookIdx >> 4) & 0xFF; b[3] = ((tag.codebookIdx & 0x0F) << 4) & 0xF0;
  b[4] = ((tag.midiNote & 0x7F) << 1) | (tag.onsetFlag & 1);
  b[5] = ((tag.cent + 32) << 2) & 0xFC; b[6] = (tag.velocity << 1) & 0xFE;
  b[7] = tag.rms; return b;
}
function unpackEpc(buf) {
  return {
    trackId: (buf[1] >> 4) & 0x0F, codebookIdx: (buf[2] << 4) | ((buf[3] >> 4) & 0x0F),
    midiNote: (buf[4] >> 1) & 0x7F, onsetFlag: buf[4] & 1,
    cent: ((buf[5] >> 2) & 0x3F) - 32, velocity: (buf[6] >> 1) & 0x7F, rms: buf[7],
    harmonics: codebook[(buf[2] << 4) | ((buf[3] >> 4) & 0x0F)],
  };
}
function packResponseFrame(epcBufs) {
  const data = Buffer.concat(epcBufs); const pl = data.length;
  const f = Buffer.alloc(7 + pl); let o = 0;
  f[o++] = 0xBB; f[o++] = 0x01; f[o++] = 0xCC;
  f[o++] = (pl >> 8) & 0xFF; f[o++] = pl & 0xFF;
  data.copy(f, o); o += pl;
  let chk = 0; for (let i = 1; i < o; i++) chk = (chk + f[i]) & 0xFF;
  f[o++] = chk; f[o++] = 0x7E; return f;
}

// ===== Generate: Piano "小蜜蜂" (C4 D4 E4 C4) × 2 + Erhu "赛马" style =====
const sr = 24000;
const durSec = 3;
const totalSamples = sr * durSec;
const pcm = Buffer.alloc(totalSamples * 2);

// Instrument profiles (alternative codebook-type harmonic sets)
const pianoHarms = (note, vel) => {
  const b = vel / 127; const d = 0.15 + (1 - b) * 0.4;
  return Array.from({length:8}, (_,i) => Math.exp(-i * d) * (1 + b * 0.3));
};
const erhuHarms = (note, vel) => {
  const b = vel / 127; const d = 0.2 + (1 - b) * 0.3;
  return Array.from({length:8}, (_,i) => Math.exp(-i * d) * (1 + b * 0.5) * (i % 2 === 0 ? 1 : 1.3));
};

// Piano score: 小蜜蜂 (notes × durations in seconds)
const pianoScore = [
  { note: 60, start: 0.00, dur: 0.4, vel: 100 }, // C4
  { note: 62, start: 0.40, dur: 0.4, vel: 95 },  // D4
  { note: 64, start: 0.80, dur: 0.4, vel: 100 }, // E4
  { note: 60, start: 1.20, dur: 0.4, vel: 90 },  // C4
  { note: 60, start: 1.60, dur: 0.3, vel: 95 },  // C4
  { note: 62, start: 1.90, dur: 0.3, vel: 90 },  // D4
  { note: 64, start: 2.20, dur: 0.3, vel: 100 }, // E4
  { note: 60, start: 2.50, dur: 0.5, vel: 85 },  // C4
];

// Erhu score: 赛马 style (fast, sliding)
const erhuScore = [
  { note: 71, start: 0.05, dur: 0.35, vel: 110, slide: 0 },  // B4
  { note: 64, start: 0.30, dur: 0.3, vel: 105, slide: 10 },  // E4
  { note: 67, start: 0.60, dur: 0.2, vel: 115, slide: 5 },   // G4
  { note: 71, start: 0.80, dur: 0.3, vel: 110, slide: 0 },   // B4
  { note: 64, start: 1.05, dur: 0.4, vel: 100, slide: 15 },  // E4 with slide up
  { note: 72, start: 1.40, dur: 0.25, vel: 120, slide: 0 },  // C5
  { note: 71, start: 1.65, dur: 0.2, vel: 115, slide: -5 },  // B4
  { note: 67, start: 1.85, dur: 0.25, vel: 110, slide: 0 },  // G4
  { note: 64, start: 2.10, dur: 0.4, vel: 100, slide: 8 },   // E4
  { note: 60, start: 2.45, dur: 0.5, vel: 95, slide: 0 },    // C4
];

function outputInstrument(s, startSample, durSamples, freq, harms, vel, vibrato) {
  for (let i = 0; i < durSamples && startSample + i < s.length; i++) {
    const t = i / sr;
    // Amplitude envelope: attack(5ms) → sustain → release(10ms)
    const attack = Math.min(1, i / (sr * 0.005));
    const release = Math.min(1, (durSamples - i) / (sr * 0.01));
    const env = Math.min(attack, release);
    // Vibrato for erhu
    const vib = vibrato ? Math.sin(2 * Math.PI * 6 * t) * vibrato : 0;
    const ff = freq * (1 + vib / 100);
    let val = 0;
    for (let h = 0; h < 8; h++) {
      const hAmp = harms[h];
      if (hAmp < 0.01) continue;
      val += Math.sin(2 * Math.PI * ff * (h + 1) * (startSample + i) / sr) * hAmp;
    }
    val *= env * vel / 127 * 0.3;
    const idx = (startSample + i) * 2;
    const clipped = Math.max(-32768, Math.min(32767, Math.round(val * 32768)));
    const existing = s.readInt16LE(idx);
    const mixed = Math.max(-32768, Math.min(32767, existing + clipped));
    s.writeInt16LE(mixed, idx);
  }
}

// Generate all notes
for (const n of pianoScore) {
  const freq = 440 * Math.pow(2, (n.note - 69) / 12);
  const harms = pianoHarms(n.note, n.vel);
  const startS = Math.round(n.start * sr);
  const durS = Math.round(n.dur * sr);
  outputInstrument(pcm, startS, durS, freq, harms, n.vel, 0);
}
for (const n of erhuScore) {
  const baseFreq = 440 * Math.pow(2, (n.note - 69) / 12);
  const harms = erhuHarms(n.note, n.vel);
  const startS = Math.round(n.start * sr);
  const durS = Math.round(n.dur * sr);
  // Sliding pitch
  for (let i = 0; i < durS && startS + i < totalSamples; i++) {
    const slideHZ = n.slide * (i / durS);
    const freq = baseFreq * Math.pow(2, slideHZ / 1200);
    const t = i / sr;
    const attack = Math.min(1, i / (sr * 0.01));
    const release = Math.min(1, (durS - i) / (sr * 0.02));
    const env = Math.min(attack, release);
    const vib = Math.sin(2 * Math.PI * 7 * t) * 0.5; // erhu vibrato ~7Hz
    const ff = freq * (1 + vib / 100);
    let val = 0;
    for (let h = 0; h < 8; h++) {
      if (harms[h] < 0.01) continue;
      val += Math.sin(2 * Math.PI * ff * (h + 1) * (startS + i) / sr) * harms[h];
    }
    val *= env * n.vel / 127 * 0.25;
    const idx = (startS + i) * 2;
    const clipped = Math.max(-32768, Math.min(32767, Math.round(val * 32768)));
    const existing = pcm.readInt16LE(idx);
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, existing + clipped)), idx);
  }
}

writeWav('test_multi_input.wav', pcm, sr);
console.log(`Input: ${pcm.length}B PCM -> test_multi_input.wav`);

// ===== Encode =====
const frameSize = sr * 20 / 1000, frameBytes = frameSize * 2, half = frameSize >> 1;
const analysisBuf = [], activeTracks = new Map(), responseFrames = [];
let nextTrackId = 0, frameCount = 0;

for (let off = 0; off + frameBytes <= pcm.length; off += frameBytes) {
  const samples = [];
  for (let i = 0; i < frameSize; i++) { const v = pcm.readInt16LE(off + i * 2); samples.push(v); analysisBuf.push(v); }
  if (analysisBuf.length > 2048) analysisBuf.splice(0, analysisBuf.length - 2048);

  const frameEpcs = [], toRemove = [];

  for (const [tid, t] of activeTracks) {
    const corr = quickCheck(samples, Math.round(sr / t.freq), half);
    if (corr > 0.3) {
      t.stale = 0;
      const sigRms = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
      frameEpcs.push(packEpc({ trackId: tid, codebookIdx: t.cbIdx, midiNote: t.note, cent: t.cent, onsetFlag: 0, velocity: Math.round(corr * 127), rms: Math.round(Math.min(255, sigRms / 32768 * 255)) }));
    } else {
      t.stale++;
      if (t.stale > 3) { toRemove.push(tid); frameEpcs.push(packEpc({ trackId: tid, codebookIdx: 0, midiNote: 0, cent: 0, onsetFlag: 2, velocity: 0, rms: 0 })); }
    }
  }
  for (const tid of toRemove) activeTracks.delete(tid);

  const hasAnalysis = analysisBuf.length >= 2048;
  const checkNew = hasAnalysis ? (frameCount % 4 === 0) : (frameCount === 0);
  if (checkNew) {
    const src = hasAnalysis ? analysisBuf : samples;
    const tones = analyzeWindow(src, sr);
    const valid = tones.filter(t => quickCheck(samples, Math.round(sr / t.f0), half) > 0.3);
    for (const t of valid) {
      const dup = [...activeTracks.values()].some(at => { const r = t.f0 > at.freq ? t.f0 / at.freq : at.freq / t.f0; return Math.abs(r - Math.round(r)) < 0.05; });
      if (dup) continue;
      const lag = Math.round(sr / t.f0);
      const cbIdx = findNearest(t.harmonics);
      const midi = 12 * Math.log(t.f0 / 440) / Math.log(2) + 69;
      const note = Math.max(0, Math.min(127, Math.round(midi)));
      const cent = Math.round((midi - note) * 100);
      activeTracks.set(nextTrackId, { freq: t.f0, lag, cbIdx, note, cent, stale: 0 });
      frameEpcs.push(packEpc({ trackId: nextTrackId, codebookIdx: cbIdx, midiNote: note, cent: Math.max(-32, Math.min(31, cent)), onsetFlag: 1, velocity: Math.round(t.confidence * 127), rms: t.rms }));
      nextTrackId++;
    }
  }

  responseFrames.push(packResponseFrame(frameEpcs));
  frameCount++;
}

const epcData = Buffer.concat(responseFrames);
console.log(`Encode: ${epcData.length}B -> ${(epcData.length / durSec).toFixed(0)} B/s (${(epcData.length * 8 / 1000 / durSec).toFixed(1)} kbps)`);

// ===== Decode =====
const pcmOutParts = [];
const active = new Map();
let off = 0;
while (off + 7 <= epcData.length) {
  if (epcData[off] !== 0xBB) break;
  const dl = (epcData[off + 3] << 8) | epcData[off + 4];
  const fl = 7 + dl;
  for (let eo = off + 5; eo < off + 5 + dl; eo += 12) {
    const t = unpackEpc(epcData.slice(eo, eo + 12));
    if (t.onsetFlag === 2) { active.delete(t.trackId); continue; }
    const freq = 440 * Math.pow(2, (t.midiNote + t.cent / 100 - 69) / 12);
    if (t.rms > 0) active.set(t.trackId, { freq, harmonics: t.harmonics, rms: t.rms, velocity: t.velocity });
  }
  const buf = Buffer.alloc(frameSize * 2);
  for (let i = 0; i < frameSize; i++) {
    let s = 0;
    for (const tone of active.values()) {
      const amp = tone.rms / 255;
      let hSum = 0;
      for (let h = 0; h < 8; h++) hSum += tone.harmonics[h] * tone.harmonics[h];
      const pRms = Math.sqrt(hSum / 8) / 255;
      const gain = pRms > 0 ? amp * 1.414 / pRms : 0;
      for (let h = 0; h < 8; h++) {
        if (tone.harmonics[h] / 255 < 0.01) continue;
        s += Math.sin(2 * Math.PI * tone.freq * (h + 1) * i / sr) * gain * tone.harmonics[h] / 255 * 32768;
      }
    }
    const clipped = Math.max(-32768, Math.min(32767, Math.round(s)));
    buf.writeInt16LE(clipped, i * 2);
  }
  pcmOutParts.push(buf);
  off += fl;
}
const outPcm = Buffer.concat(pcmOutParts);
writeWav('test_multi_output.wav', outPcm, sr);

// ===== Score Comparison =====
console.log('\n=== Score Comparison ===');
console.log('Original Piano (小蜜蜂):');
for (const n of pianoScore) {
  const nn = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n.note % 12] + Math.floor(n.note / 12 - 1);
  console.log(`  ${n.start.toFixed(2)}s  On  ${nn}(${Math.round(440*Math.pow(2,(n.note-69)/12))}Hz)  vel=${n.vel}  dur=${n.dur}s`);
}

console.log('\nOriginal Erhu (赛马风格):');
for (const n of erhuScore) {
  const nn = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][n.note % 12] + Math.floor(n.note / 12 - 1);
  console.log(`  ${n.start.toFixed(2)}s  On  ${nn}(${Math.round(440*Math.pow(2,(n.note-69)/12))}Hz)  vel=${n.vel}  dur=${n.dur}s ${n.slide ? `slide=${n.slide>0?'+':''}${n.slide}cent` : ''}`);
}

console.log('\nExtracted (EPC):');
const extNotes = [];
for (let o = 0, fi = 0; o + 7 <= epcData.length; fi++) {
  const dl = (epcData[o + 3] << 8) | epcData[o + 4];
  const fl = 7 + dl;
  for (let eo = o + 5; eo < o + 5 + dl; eo += 12) {
    const t = unpackEpc(epcData.slice(eo, eo + 12));
    if (t.onsetFlag === 1 || t.onsetFlag === 2) {
      const nn = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][t.midiNote % 12] + Math.floor(t.midiNote / 12 - 1);
      extNotes.push({ time: (fi * 20 / 1000).toFixed(2) + 's', type: t.onsetFlag === 1 ? 'On' : 'Off', note: t.midiNote, name: nn, track: t.trackId });
    }
  }
  o += fl;
}
for (const n of extNotes) {
  const hits = pianoScore.filter(p => Math.abs(p.start - parseFloat(n.time)) < 0.1 && Math.abs(p.note - n.note) < 3);
  const hitsE = erhuScore.filter(p => Math.abs(p.start - parseFloat(n.time)) < 0.1 && Math.abs(p.note - n.note) < 3);
  const match = hits.length > 0 ? '← piano' : hitsE.length > 0 ? '← erhu' : '?';
  console.log(`  ${n.time}  ${n.type}  ${n.name}(${n.note})  track=${n.track}  ${match}`);
}

let totalCorrect = 0, totalWrong = 0;
for (const n of extNotes) {
  const hitP = pianoScore.some(p => n.type === 'On' && Math.abs(p.start - parseFloat(n.time)) < 0.15 && Math.abs(p.note - n.note) <= 2);
  const hitE = erhuScore.some(p => n.type === 'On' && Math.abs(p.start - parseFloat(n.time)) < 0.15 && Math.abs(p.note - n.note) <= 2);
  if (hitP || hitE) totalCorrect++; else totalWrong++;
}
console.log(`\n=== Accuracy ===`);
console.log(`  Total events: ${extNotes.length}`);
console.log(`  Correct: ${totalCorrect}`);
console.log(`  Wrong: ${totalWrong}`);
console.log(`  Precision: ${(totalCorrect / Math.max(1, extNotes.length) * 100).toFixed(1)}%`);

function writeWav(path, pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([h, pcm]));
  console.log(`  saved ${path}`);
}
