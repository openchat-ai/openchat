import fs from 'fs';

const SR = 48000;
const HOP = 8192; // ~170ms hop for fast full-track scan

function readWav(path) {
  const buf = fs.readFileSync(path);
  const dataOffset = buf.readUInt32LE(16) + 8;
  const bits = buf.readUInt16LE(34);
  const bps = bits / 8;
  const ch = buf.readUInt16LE(22);
  const totalFrames = buf.readUInt32LE(40);
  const samples = totalFrames;
  const mono = new Float64Array(samples);
  const base = dataOffset;
  for (let i = 0; i < samples && base + (i * ch + ch - 1) * bps < buf.length; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) {
      if (bps === 2) s += buf.readInt16LE(base + (i * ch + c) * 2);
      else if (bps === 1) s += (buf.readUInt8(base + i * ch + c) - 128);
    }
    mono[i] = s / ch / 32768;
  }
  return mono;
}

const samples = readWav('jzlg.wav');
const totalSec = samples.length / SR;
console.log(`Total: ${(totalSec/60).toFixed(1)}min = ${totalSec.toFixed(0)}s`);

// Energy-based section detection: compute RMS per window
const winSec = 0.5;
const winSamples = Math.round(winSec * SR);
const numWin = Math.floor(samples.length / winSamples);
const energies = [];

for (let wi = 0; wi < numWin; wi++) {
  const start = wi * winSamples;
  let sumSq = 0, peak = 0;
  for (let i = 0; i < winSamples; i++) {
    const v = samples[start + i];
    sumSq += v * v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  const rms = Math.sqrt(sumSq / winSamples);
  energies.push({ time: wi * winSec, rms, peak });
}

// Find loud sections (likely music) vs quiet (silence between tracks)
const avgRms = energies.reduce((s, e) => s + e.rms, 0) / energies.length;
console.log(`\nAvg RMS: ${avgRms.toFixed(6)}`);

// Segment into "songs" by silence detection
const silenceThresh = avgRms * 0.05;
let inSong = false;
const songs = [];
let songStart = 0;

for (const e of energies) {
  if (!inSong && e.rms > silenceThresh) {
    inSong = true;
    songStart = e.time;
  } else if (inSong && e.rms <= silenceThresh && e.time - songStart > 5) {
    inSong = false;
    songs.push({ start: songStart, end: e.time, dur: e.time - songStart });
  }
}
if (inSong) songs.push({ start: songStart, end: totalSec, dur: totalSec - songStart });

console.log(`\nDetected tracks (${songs.length}):`);
for (let i = 0; i < songs.length; i++) {
  const s = songs[i];
  const startMin = Math.floor(s.start / 60), startSec = Math.floor(s.start % 60);
  const endMin = Math.floor(s.end / 60), endSec = Math.floor(s.end % 60);
  console.log(`  Track ${i+1}: ${startMin}:${String(startSec).padStart(2,'0')} → ${endMin}:${String(endSec).padStart(2,'0')} (${s.dur.toFixed(1)}s)`);
}

// For the first song (Hot California ~6:30), output detailed structure
if (songs.length > 0) {
  const first = songs[0];
  const startSample = Math.round(first.start * SR);
  const durSamples = Math.round(first.dur * SR);
  
  console.log(`\n=== First track (${first.dur.toFixed(0)}s) — Structure analysis ===`);
  
  // Scan first song with fine resolution
  const FINE_HOP = 2048; // ~43ms
  const halfSample = Math.min(durSamples, samples.length - startSample);
  const fineFrames = Math.floor(halfSample / FINE_HOP);
  
  let prevClass = -1;
  const sections = [];
  let sectionStart = 0;
  
  for (let fi = 0; fi < fineFrames; fi++) {
    const start = startSample + fi * FINE_HOP;
    // Compute spectral centroid as rough timbre indicator
    let sumMag = 0, sumFreq = 0;
    
    // Simple dominant freq: find zero crossings
    let zeroCross = 0;
    for (let i = 0; i < FINE_HOP - 1; i++) {
      if ((samples[start + i] >= 0 && samples[start + i + 1] < 0) || 
          (samples[start + i] < 0 && samples[start + i + 1] >= 0)) zeroCross++;
    }
    
    const time = (start - startSample) / SR + first.start;
    
    // At ~1s resolution, show dominant low-frequency content
    if (fi % Math.round(SR / FINE_HOP) === 0) {
      const zcr = zeroCross / FINE_HOP * SR / 2;
      const energy = energies.find(e => Math.abs(e.time - time) < winSec/2);
      const rms = energy ? energy.rms : 0;
      const bar = '█'.repeat(Math.min(50, Math.round(rms / Math.max(...energies.map(e=>e.rms)) * 50)));
      const songTime = time - first.start;
      const sec = Math.floor(songTime), ms = Math.floor((songTime - sec) * 1000);
      console.log(`  ${sec}:${String(ms*10).padStart(3,'0')} |${bar.padEnd(50)}| zcr=${Math.round(zcr)}Hz rms=${(rms*1000).toFixed(0)}`);
    }
  }
}
