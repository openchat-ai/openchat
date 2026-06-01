import fs from 'fs';
import { parseMidi } from 'midi-file';

const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const ppq = midi.header.ticksPerBeat;

// Get tempo
let tempo = 120;
for (const e of midi.tracks[0]) {
  if (e.type === 'setTempo') { tempo = 60000000 / e.microsecondsPerBeat; break; }
}
const spb = 60 / tempo; // seconds per beat

console.log(`Tempo: ${tempo} BPM, PPQ: ${ppq}, SPB: ${spb}s`);

// Track info + proper timing
for (let ti = 0; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti];
  let name = '', program = 0, noteCount = 0;
  for (const e of track) {
    if (e.type === 'trackName') name = e.text;
    if (e.type === 'programChange') program = e.programNumber;
    if (e.type === 'noteOn' && e.velocity > 0) noteCount++;
  }
  // Collect notes with proper timing
  let tick = 0;
  const notes = []; // {tick, note, vel}
  for (const e of track) {
    tick += e.deltaTime || 0;
    if (e.type === 'noteOn' && e.velocity > 0) notes.push({ tick, note: e.noteNumber, vel: e.velocity });
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      // noteOff - match to a noteOn
    }
  }
  if (notes.length === 0) continue;
  const pitches = notes.map(n => n.noteNumber);
  const minP = Math.min(...pitches), maxP = Math.max(...pitches);
  const avgP = pitches.reduce((s, n) => s + n, 0) / pitches.length;
  const durationSec = notes[notes.length-1].tick / ppq * spb;
  console.log(`Track ${ti+1}: "${name}" pgm=${program} ${noteCount} notes pitch ${minP}-${maxP} avg=${avgP.toFixed(0)} dur=${durationSec.toFixed(1)}s`);
}

// === Detect T5 section (3:20-3:30 = 200-210s) across all tracks ===
console.log('\n=== T5 section (200-210s) ground truth ===');
for (let ti = 0; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti];
  let name = '', program = 0;
  for (const e of track) { if (e.type === 'trackName') name = e.text; if (e.type === 'programChange') program = e.programNumber; }

  // Build active notes over time
  let tick = 0;
  const noteOns = {}; // noteNumber -> startTick
  const t5Freqs = [];
  for (const e of track) {
    tick += e.deltaTime || 0;
    const sec = tick / ppq * spb;
    if (sec >= 200 && sec <= 210) {
      if (e.type === 'noteOn' && e.velocity > 0) {
        noteOns[e.noteNumber] = tick;
        const freq = 440 * Math.pow(2, (e.noteNumber - 69) / 12);
        t5Freqs.push({ time: sec, note: e.noteNumber, freq, type: 'on' });
      }
      if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
        if (noteOns[e.noteNumber]) {
          const startSec = noteOns[e.noteNumber] / ppq * spb;
          const dur = sec - startSec;
          const freq = 440 * Math.pow(2, (e.noteNumber - 69) / 12);
          t5Freqs.push({ time: startSec, note: e.noteNumber, freq, dur, type: 'note' });
          delete noteOns[e.noteNumber];
        }
      }
    }
  }

  // Close remaining noteOns
  for (const [n, start] of Object.entries(noteOns)) {
    const startSec = start / ppq * spb;
    const freq = 440 * Math.pow(2, (n - 69) / 12);
    t5Freqs.push({ time: startSec, note: parseInt(n), freq, dur: 210 - startSec, type: 'note' });
  }

  const notes = t5Freqs.filter(x => x.type === 'note');
  if (notes.length > 0) {
    const freqs = notes.map(n => n.freq);
    console.log(`\nTrack ${ti+1}: "${name}" pgm=${program} (${notes.length} notes in T5):`);
    console.log(`  Freq range: ${Math.min(...freqs).toFixed(0)}-${Math.max(...freqs).toFixed(0)}Hz`);
    // Sample some notes
    notes.slice(0, 8).forEach(n => console.log(`  ${(n.time - 200).toFixed(2)}s ${n.freq.toFixed(0)}Hz note=${n.note} dur=${n.dur.toFixed(2)}s`));
  }
}

// === Drum track analysis ===
console.log('\n=== Drum Track Analysis ===');
const drumTrack = midi.tracks[5]; // Track 6 is Percussions
let tick = 0;
const drumHits = [];
for (const e of drumTrack) {
  tick += e.deltaTime || 0;
  if (e.type === 'noteOn' && e.velocity > 0) {
    const sec = tick / ppq * spb;
    // MIDI drum keys: 35=Bass Drum, 38=Snare, 42=Hi-Hat Closed, 46=Hi-Hat Open, 49=Crash, 51=Ride
    let name = 'Unknown';
    if (e.noteNumber === 35 || e.noteNumber === 36) name = 'Kick';
    else if (e.noteNumber === 38 || e.noteNumber === 40) name = 'Snare';
    else if (e.noteNumber === 42 || e.noteNumber === 44) name = 'HiHat';
    else if (e.noteNumber === 46) name = 'HiHat-Open';
    else if (e.noteNumber === 49 || e.noteNumber === 57) name = 'Crash';
    else if (e.noteNumber === 51 || e.noteNumber === 53) name = 'Ride';
    drumHits.push({ time: sec, note: e.noteNumber, name });
  }
}
console.log(`Total drum hits: ${drumHits.length}`);
const categories = {};
drumHits.forEach(d => { categories[d.name] = (categories[d.name] || 0) + 1; });
for (const [k, v] of Object.entries(categories)) console.log(`  ${k}: ${v}`);
// First 20 drum hits
drumHits.slice(0, 20).forEach(d => console.log(`  ${d.time.toFixed(2)}s note=${d.note} ${d.name}`));
