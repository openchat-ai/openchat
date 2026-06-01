import fs from 'fs';
import { parseMidi } from 'midi-file';

const midi = parseMidi(fs.readFileSync('hotel-california.mid'));

console.log('Format:', midi.header.format, 'Tracks:', midi.tracks.length, 'Division:', midi.header.ticksPerBeat);

// GM instrument mapping
const GM = {
  0:'Piano',24:'Nylon Guitar',25:'Steel Guitar',26:'Jazz Guitar',27:'Clean Guitar',
  28:'Muted Guitar',29:'Overdrive Guitar',30:'Distortion Guitar',31:'Guitar Harmonics',
  32:'Acoustic Bass',33:'Finger Bass',34:'Pick Bass',35:'Fretless Bass',
  24:'Acoustic Guitar (nylon)',25:'Acoustic Guitar (steel)',29:'Overdriven Guitar',30:'Distortion Guitar',
  33:'Electric Bass (finger)',18:'Rock Organ',60:'French Horn',94:'Pad 7 (halo)',
  122:'Seashore',
};

for (let ti = 0; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti];
  let name = '', program = 0, noteCount = 0;
  for (const e of track) {
    if (e.type === 'trackName') name = e.text;
    if (e.type === 'programChange') program = e.programNumber;
    if (e.type === 'noteOn' && e.velocity > 0) noteCount++;
  }
  const instr = GM[program] || `Program ${program}`;
  const notes = track.filter(e => e.type === 'noteOn' && e.velocity > 0);
  const pitches = notes.map(n => n.noteNumber);
  const minP = Math.min(...pitches), maxP = Math.max(...pitches);
  const avgP = pitches.reduce((s, n) => s + n, 0) / pitches.length;
  console.log(`Track ${ti+1}: "${name}" ${instr} ${noteCount} notes pitch ${minP}-${maxP} avg=${avgP.toFixed(0)}`);
}

// Get tempo
let tempo = 120;
for (const e of midi.tracks[0]) {
  if (e.type === 'setTempo') { tempo = 60000000 / e.microsecondsPerBeat; break; }
}
console.log(`\nTempo: ${tempo} BPM`);

// Print note summary for T5 section (3:20-3:30, guitar solo)
const ppq = midi.header.ticksPerBeat;
const t5Start = 200; // seconds
const t5End = 210;
for (let ti = 0; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti];
  let name = '', program = 0;
  for (const e of track) {
    if (e.type === 'trackName') name = e.text;
    if (e.type === 'programChange') program = e.programNumber;
  }
  // Convert tick to seconds
  let tickTime = 0;
  const t5Notes = [];
  for (const e of track) {
    tickTime += e.deltaTime || 0;
    if (e.type === 'noteOn' && e.velocity > 0) {
      const sec = tickTime / ppq / (tempo / 60);
      if (sec >= t5Start && sec < t5End) {
        // Find matching noteOff
        let offTick = tickTime;
        for (const e2 of track) {
          offTick += e2.deltaTime || 0;
          if (e2.type === 'noteOff' || (e2.type === 'noteOn' && e2.noteNumber === e.noteNumber && e2.velocity === 0)) {
            if (offTick > tickTime) break;
          }
        }
        const dur = (offTick - tickTime) / ppq / (tempo / 60);
        const freq = 440 * Math.pow(2, (e.noteNumber - 69) / 12);
        const name_note = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][e.noteNumber % 12] + Math.floor(e.noteNumber / 12 - 1);
        t5Notes.push({ time: sec, dur, note: e.noteNumber, name: name_note, freq });
      }
    }
  }
  if (t5Notes.length > 0) {
    console.log(`\nTrack ${ti+1}: "${name}" (${t5Notes.length} notes in T5):`);
    t5Notes.slice(0, 15).forEach(n => console.log(`  ${(n.time - 200).toFixed(2)}s ${n.name} ${n.freq.toFixed(0)}Hz dur=${n.dur.toFixed(2)}s`));
  }
}
