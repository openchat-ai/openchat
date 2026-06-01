// debug track5 notes
import fs from 'fs';
import { parseMidi } from 'midi-file';
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;
const track5 = midi.tracks[5];
let tick = 0, noteNums = new Set(), noteCounts = {};
for (const e of track5) {
  tick += e.deltaTime || 0;
  if (e.type === 'noteOn' && e.velocity > 0) {
    noteNums.add(e.noteNumber);
    noteCounts[e.noteNumber] = (noteCounts[e.noteNumber] || 0) + 1;
  }
}
const sorted = [...noteNums].sort((a,b)=>a-b);
console.log(`Track 5 note count: ${track5.filter(e=>e.type==='noteOn'&&e.velocity>0).length}`);
console.log(`Unique pitches: ${sorted.length}`);
console.log(`Range: ${sorted[0]}-${sorted[sorted.length-1]}`);
console.log(`Top notes:`);
const topN = Object.entries(noteCounts).sort((a,b)=>b[1]-a[1]).slice(0,20);
for (const [n, c] of topN) console.log(`  MIDI ${n} (${freq(n).toFixed(1)}Hz): x${c}`);
function freq(m) { return 440 * Math.pow(2, (m-69)/12); }
