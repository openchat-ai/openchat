import fs from 'fs';

const SR = 48000;
const HOP = 2048; // coarser hop for fast scan

function readWav(path, maxSec = 60) {
  const buf = fs.readFileSync(path);
  const dataOffset = buf.readUInt32LE(16) + 8;
  const bits = buf.readUInt16LE(34);
  const bytesPerSample = bits / 8;
  const ch = buf.readUInt16LE(22);
  const totalFrames = buf.readUInt32LE(40);
  const maxSamples = Math.min(totalFrames, Math.round(maxSec * SR)) * ch;
  const samples = new Float64Array(Math.floor(maxSamples / ch));
  for (let i = 0; i < samples.length && i * ch < maxSamples; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += buf.readInt16LE(dataOffset + (i * ch + c) * 2) / 32768;
    samples[i] = s / ch; // mix to mono
  }
  return samples;
}

function yinDetect(frame, sr) {
  const fs_ = 2048, minL = Math.ceil(sr / 2000), maxL = Math.floor(sr / 40);
  if (frame.length < fs_) return null;
  const diff = new Float64Array(maxL + 1);
  for (let t = 0; t <= maxL; t++) { let s = 0; for (let i = 0; i < fs_ - t; i++) { const d = frame[i] - frame[i + t]; s += d * d; } diff[t] = s; }
  const cmn = new Float64Array(maxL + 1); cmn[0] = 1; let rs = 0;
  for (let t = 1; t <= maxL; t++) { rs += diff[t]; cmn[t] = rs > 0 ? diff[t] * t / rs : 1; if (t >= minL && cmn[t] < 0.15) { const a = cmn[t - 1], b = cmn[t], c = cmn[t + 1]; const d = a - 2 * b + c; const ft = Math.abs(d) > 1e-12 ? t + (a - c) / (2 * d) : t; const f = sr / ft; return { freq: f, conf: Math.max(0, 1 - cmn[t]) }; } }
  return null;
}

function freqToMidi(f) { return 12 * Math.log2(f / 440) + 69; }
function midiToNoteName(m) { const n = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; const r = Math.round(m); return n[r % 12] + (Math.floor(r / 12) - 1); }

// Known Hotel California chord progression (Bm)
// Verse: Bm | F# | A | E | G | D | Em | F#
// Chorus: G | D | F#m | Bm | G | D | E
// Outro: Bm | F# | A | E | G | D | Em | F#
const chords = {
  'B':  { root: 11, type: 'm' }, 'F#': { root: 6, type: '#' },
  'A':  { root: 9, type: '' }, 'E':  { root: 4, type: '' },
  'G':  { root: 7, type: '' }, 'D':  { root: 2, type: '' },
  'Em': { root: 4, type: 'm' }, 'F#m': { root: 6, type: 'm' },
};
function chordExpectedNotes(chordName) {
  const c = chords[chordName];
  if (!c) return [];
  const r = c.root;
  const thirds = c.type === 'm' ? [r, r + 3, r + 7] : [r, r + 4, r + 7];
  return thirds.map(t => t + 12); // in octave 4-5 for display
}

console.log('=== Hotel California — Full Analysis (first 60s) ===\n');

const samples = readWav('jzlg.wav', 60);
const totalFrames = Math.floor((samples.length - 2048) / HOP);

console.log('Chord section analysis (every 5.3s window, dominant pitch):');
let sectionNotes = [];
for (let fi = 0; fi < totalFrames; fi++) {
  const start = fi * HOP;
  const frame = samples.slice(start, start + 2048);
  const det = yinDetect(frame, SR);
  const time = (start / SR);
  if (det && det.conf > 0.3) {
    const midi = freqToMidi(det.freq);
    const name = midiToNoteName(midi);
    sectionNotes.push({ time, freq: det.freq, name, midi, conf: det.conf });
  }
}

// Group by 4-second sections and show dominant notes
const SECTION = 4;
const maxSec = 60;
const numSec = Math.floor(maxSec / SECTION);
console.log('Time\t| Dominant notes (top 3 per 4s window)\n' + '-'.repeat(60));
for (let s = 0; s < numSec; s++) {
  const tStart = s * SECTION, tEnd = (s + 1) * SECTION;
  const inWin = sectionNotes.filter(n => n.time >= tStart && n.time < tEnd);
  const counts = {};
  for (const n of inWin) {
    const rounded = Math.round(n.midi);
    counts[rounded] = (counts[rounded] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const notes = sorted.map(([m, c]) => `${midiToNoteName(Number(m))}(${c}f)`).join(' ');
  console.log(` ${tStart.toString().padStart(2)}-${tEnd}s\t| ${notes}`);
}

// Check if intro matches: famous Bm arpeggio
console.log('\nFirst 10s raw detections (checking intro):');
let introCount = 0;
for (const n of sectionNotes) {
  if (n.time > 10) break;
  if (introCount++ > 40) break;
  console.log(`  ${n.time.toFixed(2)}s  ${n.name.padEnd(5)} ${n.freq.toFixed(1)}Hz  conf=${n.conf.toFixed(2)}`);
}

console.log('\nConclusion:');
// Check for B (the key)
const bNotes = sectionNotes.filter(n => Math.round(n.midi) % 12 === 11);
const allNotes = sectionNotes.map(n => Math.round(n.midi) % 12);
const freqMap = {};
for (const note of allNotes) freqMap[note] = (freqMap[note] || 0) + 1;
console.log('  Pitch class distribution (first 60s):');
const classNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
for (let i = 0; i < 12; i++) {
  const pct = (freqMap[i] || 0) / allNotes.length * 100;
  const bar = '█'.repeat(Math.round(pct));
  console.log(`  ${classNames[i].padEnd(3)} ${(freqMap[i] || 0).toString().padStart(4)}f (${pct.toFixed(1)}%) ${bar}`);
}
