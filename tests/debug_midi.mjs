// debug midi tracks
import fs from 'fs';
import { parseMidi } from 'midi-file';
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, notes = 0, ch = new Set();
  for (const e of track) { tick += e.deltaTime || 0; if (e.type === 'noteOn' && e.velocity > 0) { notes++; ch.add(e.channel); } }
  // get program name if present
  const pn = track.find(e => e.type === 'programChange');
  // track name
  const tn = track.find(e => e.type === 'trackName');
  // instrument name meta
  const iname = track.find(e => e.type === 'instrumentName');
  console.log(`Track ${ti}: ${notes} notes, ch=[${[...ch]}], prog=${pn?.programNumber??'?'}, name="${tn?.text||iname?.text||'?'}"`);
}
