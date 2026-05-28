// Generate EPC recording file from music score (小蜜蜂 / Frère Jacques)
// Syncs with Dart codec: 7 harmonic bands × 8b, 96b frame, ResponseFrame + recording header
import fs from 'fs';
const { writeFileSync } = fs;

const sr = 48000;

// Generate 7 harmonic band energies for a given MIDI note
// Band 0 = F0 fundamental, Band 1..6 = harmonics 2..7
function harmonicBands(midiNote) {
  const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
  const bands = [];
  for (let h = 0; h < 7; h++) {
    const hz = freq * (h + 1);
    // Piano-like energy: fundamental strongest, exponential rolloff
    let energy = 1.0;
    if (h > 0) energy = Math.pow(0.6, h); // harmonic decay
    // Boost bands that align with piano resonance (odd harmonics stronger)
    if (h % 2 === 0 && h > 0) energy *= 1.3;
    bands.push(Math.round(Math.max(0, Math.min(255, energy * 220))));
  }
  return bands;
}

// 小蜜蜂 score: [midiNote, durationSec]
// C4=60, D4=62, E4=64, F4=65, G4=67, A4=69, G3=55
const notes = [
  [60, 0.25], [62, 0.25], [64, 0.25], [60, 0.25],
  [60, 0.25], [62, 0.25], [64, 0.25], [60, 0.25],
  [64, 0.25], [65, 0.25], [67, 0.5],
  [64, 0.25], [65, 0.25], [67, 0.5],
  [67, 0.125],[69, 0.125],[67, 0.125],[65, 0.125],[64, 0.25],[60, 0.25],
  [67, 0.125],[69, 0.125],[67, 0.125],[65, 0.125],[64, 0.25],[60, 0.25],
  [60, 0.25], [55, 0.25], [60, 0.5],
  [60, 0.25], [55, 0.25], [60, 0.5],
];

// Generate EPC tags (12B each, 1 per 20ms frame)
const epcFrames = [];
for (const [midi, dur] of notes) {
  const bands = harmonicBands(midi);
  const nFrames = Math.round(dur * sr / 960); // 960 samples = 20ms at 48kHz
  for (let f = 0; f < nFrames; f++) {
    const buf = Buffer.alloc(12);
    buf[0] = 0x02; // tagType=spectrum
    buf[1] = (0 << 4) | 0; // trackId=0, instrument=0(piano)
    buf[2] = ((midi & 0x7F) << 1) | (f === 0 ? 1 : 0); // midiNote + onset
    buf[3] = (100 << 1) & 0xFE; // velocity
    buf[4] = 180; // rms
    for (let i = 0; i < 7; i++) buf[5 + i] = bands[i]; // 7 × 8b directly
    epcFrames.push(buf);
  }
}

// Wrap in ResponseFrames (max 12 tags per RF)
const responseFrames = [];
for (let i = 0; i < epcFrames.length; i += 12) {
  const batch = epcFrames.slice(i, Math.min(i + 12, epcFrames.length));
  const epcBytes = Buffer.concat(batch);
  const pl = epcBytes.length;
  const f = Buffer.alloc(7 + pl);
  let o = 0; f[o++] = 0xBB; f[o++] = 0x01; f[o++] = 0xCC;
  f[o++] = (pl >> 8) & 0xFF; f[o++] = pl & 0xFF;
  if (pl > 0) epcBytes.copy(f, o); o += pl;
  let ck = 0; for (let j = 1; j < o; j++) ck = (ck + f[j]) & 0xFF;
  f[o++] = ck; f[o++] = 0x7E;
  responseFrames.push(f);
}

// Build recording file: header + all RFs
// Header: EPC1(4B) + version(2B: major=0,minor=1) + spare(2B)
const header = Buffer.from([0x45,0x50,0x43,0x31, 0x00,0x01, 0x00,0x00]);
const recording = Buffer.concat([header, ...responseFrames]);

writeFileSync('xiaomifeng.epc', recording);
console.log('Generated xiaomifeng.epc:', recording.length, 'bytes');
console.log('  EPC tags:', epcFrames.length);
console.log('  Response frames:', responseFrames.length);

// Verify header
console.log('  Header magic OK:', header[0]===0x45 && header[1]===0x50 && header[2]===0x43 && header[3]===0x31);

// Decode and synthesize WAV for preview
let totalDur = 0;
for (const n of notes) totalDur += n[1];
totalDur += 0.5;
const totalSamples = Math.round(totalDur * sr);
const outPcm = Buffer.alloc(totalSamples * 2);

const activeTones = new Map();
let rfIdx = 0;
let outOff = 0;

// For each response frame
for (const rf of responseFrames) {
  // Parse RF header
  let o = 0;
  if (rf[o] !== 0xBB) break;
  const pl = (rf[o + 3] << 8) | rf[o + 4];
  // Parse each EPC tag
  for (let eo = 5; eo < 5 + pl; eo += 12) {
    const buf = rf.slice(eo, eo + 12);
    const type = buf[0];
    if (type !== 0x02) continue;
    const tid = (buf[1] >> 4) & 0xF;
    const note = (buf[2] >> 1) & 0x7F;
    const vel = (buf[3] >> 1) & 0x7F;
    const rms = buf[4];
    if (vel === 0 && rms === 0) { activeTones.delete(tid); continue; }
    const bands = [];
    for (let i = 0; i < 7; i++) bands.push(buf[5 + i]);
    const freq = 440 * Math.pow(2, (note - 69) / 12);
    activeTones.set(tid, { freq, bands, rms, vel });

    // Synthesize 20ms (960 samples at 48kHz)
    const nOut = 960;
    for (const tone of activeTones.values()) {
      const amp = tone.rms / 255 * tone.vel / 127 * 0.35;
      if (amp < 0.001) continue;
      // Harmonic envelope synth (same as wavetable_synth.dart)
      const maxH = Math.min(100, Math.floor(sr / 2 / tone.freq));
      const hGains = [];
      for (let h = 1; h <= maxH; h++) {
        const hz = tone.freq * h;
        if (hz >= 8000) break;
        const be = h <= 7 ? tone.bands[h - 1] / 255 : tone.bands[6] / 255;
        if (be < 0.01) { hGains.push(0); continue; }
        const rolloff = Math.pow(0.85, h - 1);
        hGains.push(be * rolloff * amp);
      }

      const velRatio = tone.vel / 127;
      const attackMs = 3;
      const decayRate = 3 - velRatio * 1.5; // piano
      const attackSamples = attackMs * sr / 1000;

      for (let i = 0; i < nOut; i++) {
        let s = 0;
        const t = i / sr;
        const notePos = i / nOut;
        const env = Math.min(1, i / attackSamples) * Math.exp(-notePos * decayRate);
        for (let h = 0; h < hGains.length; h++) {
          if (hGains[h] < 0.001) continue;
          const hz = tone.freq * (h + 1);
          if (hz > 5000) {
            s += (Math.random() * 2 - 1) * hGains[h] * 0.5;
          }
          s += Math.sin(2 * Math.PI * hz * t) * hGains[h] * 32768;
        }
        s *= env;
        const idx = (outOff + i) * 2;
        if (idx + 1 >= outPcm.length) break;
        const c = Math.max(-32768, Math.min(32767, Math.round(s)));
        const existing = outPcm.readInt16LE(idx);
        outPcm.writeInt16LE(Math.max(-32768, Math.min(32767, existing + c)), idx);
      }
    }
    outOff += nOut;
  }
}

// Write WAV preview
function writeWav(path, pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+pcm.length,4);h.write('WAVE',8);
  h.write('fmt ',12);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);
  h.writeUInt16LE(1,22);h.writeUInt32LE(sr,24);h.writeUInt32LE(sr*2,28);
  h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);
  h.writeUInt32LE(pcm.length,40);
  writeFileSync(path,Buffer.concat([h,pcm]));
  console.log('Saved',path);
}
writeWav('xiaomifeng_epc.wav', outPcm, sr);

console.log('\nDone. Files: xiaomifeng.epc, xiaomifeng_epc.wav');
