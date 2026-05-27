// Segment-based EPC analyzer: detect note boundaries, extract per-segment features
import fs from 'fs';

const sr = 24000;

// ===== Generate piano 小蜜蜂 with real note boundaries =====
const notes = [
  [60,0],[62,0],[64,0],[60,0], [60,0],[62,0],[64,0],[60,0],
  [64,0],[65,0],[67,0], [64,0],[65,0],[67,0],
  [67,0,0.125],[69,0,0.125],[67,0,0.125],[65,0,0.125],[64,0],[60,0],
  [67,0,0.125],[69,0,0.125],[67,0,0.125],[65,0,0.125],[64,0],[60,0],
  [60,0],[55,0],[60,0], [60,0],[55,0],[60,0],
];
const durSec = 8.5;
const nSamples = Math.round(durSec * sr);
const pcm = Buffer.alloc(nSamples * 2);

let tOff = 0;
for (const [midi, _, noteDur] of notes) {
  const dur = noteDur || 0.25;
  const nSmp = Math.round(dur * sr);
  const freq = 440 * Math.pow(2, (midi - 69) / 12);
  for (let i = 0; i < nSmp && tOff + i < nSamples; i++) {
    const env = Math.min(1, i / (sr * 0.005)) * Math.exp(-i / (sr * 0.12));
    let v = 0;
    for (let h = 1; h <= 16; h++) v += Math.sin(2 * Math.PI * freq * h * (tOff + i) / sr) * Math.pow(0.7, h - 1);
    const val = Math.max(-32768, Math.min(32767, Math.round(v * env * 0.3 * 32768)));
    pcm.writeInt16LE(val, (tOff + i) * 2);
  }
  tOff += nSmp;
}

// ===== Segment detector: RMS-based onset/offset =====
const frameLen = 480; // 20ms
const nFrames = Math.floor(nSamples / frameLen);
const frameRms = [];
for (let f = 0; f < nFrames; f++) {
  let e = 0;
  for (let i = 0; i < frameLen; i++) { const v = pcm.readInt16LE((f * frameLen + i) * 2); e += v * v; }
  frameRms.push(Math.sqrt(e / frameLen));
}

// Find segments: RMS jump > 2x = onset, drop < 0.3x = offset
const segments = [];
let segStart = null, prevRms = 0;
for (let f = 0; f < nFrames; f++) {
  const rms = frameRms[f];
  if (segStart === null && rms > prevRms * 2 && rms > 200) {
    segStart = f;
  } else if (segStart !== null && rms < frameRms[segStart] * 0.3) {
    segments.push({ startF: segStart, endF: f - 1 });
    segStart = null;
  }
  // End of audio
  if (segStart !== null && f === nFrames - 1) {
    segments.push({ startF: segStart, endF: f });
  }
  prevRms = rms;
}

console.log('Detected segments:', segments.length);
console.log('Expected notes:', notes.length);

// ===== Per-segment analysis =====
function analyzeSegment(startSample, endSample, segmentIdx) {
  const nSeg = endSample - startSample + 1;
  const nHalf = nSeg >> 1;

  // F0 from autocorrelation on segment
  const minLag = Math.floor(sr / 1500), maxLag = Math.floor(sr / 40);
  let bestLag = 0, bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0, n = 0;
    for (let i = 0; i < nHalf; i++) {
      const v1 = pcm.readInt16LE((startSample + i) * 2);
      const v2 = pcm.readInt16LE((startSample + i + lag) * 2);
      c += v1 * v2; n += v1 * v1 + v2 * v2;
    }
    const corr = n > 0 ? c / Math.sqrt(n) : 0;
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  const f0 = bestLag > 0 ? sr / bestLag : 0;
  const midi = f0 > 0 ? 12 * Math.log(f0 / 440) / Math.log(2) + 69 : 0;
  const note = Math.max(0, Math.min(127, Math.round(midi)));

  // Velocity: peak RMS in first 3 frames
  let peakRms = 0;
  for (let i = 0; i < Math.min(frameLen * 3, nSeg); i += frameLen) {
    let e = 0, cnt = 0;
    for (let j = i; j < Math.min(i + frameLen, nSeg); j++) { const v = pcm.readInt16LE((startSample + j) * 2); e += v * v; cnt++; }
    const r = Math.sqrt(e / cnt);
    if (r > peakRms) peakRms = r;
  }
  const vel = Math.round(Math.max(1, Math.min(127, peakRms / 32768 * 127)));

  // Attack frames: time from start to peak RMS
  let attackFrames = 0;
  for (let i = 0; i < Math.min(frameLen * 5, nSeg); i += frameLen) {
    let e = 0, cnt = 0;
    for (let j = i; j < Math.min(i + frameLen, nSeg); j++) { const v = pcm.readInt16LE((startSample + j) * 2); e += v * v; cnt++; }
    if (Math.sqrt(e / cnt) >= peakRms * 0.8) break;
    attackFrames++;
  }

  // Decay: amplitude drop rate after peak
  const peakSample = Math.min(attackFrames * frameLen + frameLen, nSeg);
  let decaySamples = 0;
  if (peakSample < nSeg - frameLen) {
    const halfRms = peakRms * 0.5;
    for (let i = peakSample; i < nSeg; i += frameLen) {
      let e = 0, cnt = 0;
      for (let j = i; j < Math.min(i + frameLen, nSeg); j++) { const v = pcm.readInt16LE((startSample + j) * 2); e += v * v; cnt++; }
      if (Math.sqrt(e / cnt) <= halfRms) break;
      decaySamples += frameLen;
    }
  }

  const nn = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][note % 12] + Math.floor(note / 12 - 1);
  console.log(`  Seg${segmentIdx}: note=${nn}(${note}) f0=${Math.round(f0)}Hz vel=${vel} attack=${attackFrames}fr decay=${decaySamples}sm segLen=${nSeg}`);
  return { note, vel, attack: attackFrames, decay: decaySamples };
}

console.log('\nSegment analysis:');
const results = [];
let si = 0;
for (const seg of segments) {
  const r = analyzeSegment(seg.startF * 480, seg.endF ? seg.endF * 480 + 480 : seg.endF * 480 + 480, si);
  if (r.note > 0) results.push(r);
  si++;
}

// Accuracy
console.log('\nAccuracy:');
let correct = 0;
for (const r of results) {
  const hit = notes.some(n => Math.abs(n[0] - r.note) <= 1);
  if (hit) correct++;
}
console.log(`  ${correct}/${results.length} notes correct (${(correct / results.length * 100).toFixed(0)}%)`);