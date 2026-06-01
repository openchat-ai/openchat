import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024;
const MIDI_OFFSET = 200, T_START = 0, T_END = 10;

// 1. MIDI ground truth for T5 (200-210s absolute)
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000; // seconds per beat
const ppq = midi.header.ticksPerBeat;

// Track name & instrument
const trackInfo = [];
for (let ti = 0; ti < midi.tracks.length; ti++) {
  let name = '', program = 0;
  for (const e of midi.tracks[ti]) {
    if (e.type === 'trackName') name = e.text;
    if (e.type === 'programChange') program = e.programNumber;
  }
  trackInfo.push({ name, program });
}
console.log('Track info:', trackInfo.map((t, i) => `T${i}: "${t.name}" pgm=${t.program}`).join(', '));

// Build active note list for T5 window
const gt = [];
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti];
  // First pass: find all noteOn events before+within T5 window
  let tick = 0;
  const actives = {}; // noteNum -> {tick, freq}
  const absStart = T_START + MIDI_OFFSET, absEnd = T_END + MIDI_OFFSET;

  for (const e of track) {
    tick += e.deltaTime || 0;
    const sec = tick / ppq * spb;

    if (e.type === 'noteOn' && e.velocity > 0) {
      if (sec < absEnd) {
        actives[e.noteNumber] = { tick, freq: 440 * Math.pow(2, (e.noteNumber - 69) / 12) };
      }
    }
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      if (actives[e.noteNumber]) {
        const startTick = actives[e.noteNumber].tick;
        const startSec = startTick / ppq * spb;
        const durSec = (tick - startTick) / ppq * spb;
        // Only count if the note overlaps with T5 window
        if (startSec < absEnd && startSec + durSec > absStart) {
          const instr = ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'other';
          const name = (ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'drum');
          gt.push({ time: startSec, freq: actives[e.noteNumber].freq, dur: durSec, instr, name, midiNum: e.noteNumber, track: ti });
        }
        delete actives[e.noteNumber];
      }
    }
    if (sec > absEnd && Object.keys(actives).length === 0) break;
  }
  // Close remaining active notes
  for (const [n, a] of Object.entries(actives)) {
    const startSec = a.tick / ppq * spb;
    if (startSec < absEnd) {
      gt.push({ time: startSec, freq: a.freq, dur: absEnd - startSec, instr: ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'other', name: ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'drum', midiNum: parseInt(n), track: ti });
}

process.stderr.write('Reading WAV...\n');
// 2. Detect notes from audio
function readWav(path, startSec, durSec) {
  const buf = fs.readFileSync(path); let off = 12, dataOff, frames, sr;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { sr = buf.readUInt32LE(off + 12); }
    if (id === 'data') { dataOff = off + 8; frames = sz / 2 / 2; break; }
    off += 8 + sz;
  }
  const startS = Math.round((startSec || 0) * sr);
  const durS = Math.round((durSec || (frames / sr)) * sr);
  const mono = new Float64Array(durS);
  for (let i = 0; i < durS; i++) {
    const idx = (startS + i) * 2;
    mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5;
  }
  return mono;
}
function yinDetect(fr) {
  const fs = 2048, sr = SR;
  const MIN_F = 40, MAX_F = 2000;
  const mL = Math.ceil(sr / MAX_F), ML = Math.floor(sr / MIN_F);
  if (fr.length < fs) return [];
  const d = new Float64Array(ML);
  for (let t = 0; t < ML; t++) { let s = 0; for (let i = 0; i < ML; i++) { const dd = (i < fr.length ? fr[i] : 0) - (i + t < fr.length ? fr[i + t] : 0); s += dd * dd; } d[t] = s; }
  const c = new Float64Array(ML); c[0] = 1; let rs = 0;
  for (let t = 1; t < ML; t++) { rs += d[t]; c[t] = rs > 0 ? d[t] * t / rs : 1; }
  let best = { lag: 0, val: 1 }; const th = 0.15;
  for (let t = mL; t < ML - 1; t++) {
    if (c[t] < c[t - 1] && c[t] < c[t + 1]) {
      if (c[t] < th) { const a = c[t - 1], b = c[t], g = c[t + 1], de = a - 2 * b + g; const ft = Math.abs(de) > 1e-12 ? t + (a - g) / (2 * de) : t; return [{ freq: sr / ft, conf: Math.max(0, 1 - c[t]) }]; }
      if (c[t] < best.val) { best = { lag: t, val: c[t] }; }
    }
  }
  if (best.lag > 0) return [{ freq: sr / best.lag, conf: Math.max(0.05, 1 - best.val) * 0.5 }];
  return [];
}
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function peakTrackDetect(fr) {
  const fs = 2048; if (fr.length < fs) return [];
  const w = new Float64Array(fs); for (let i = 0; i < fs; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fs - 1)));
  const re = new Float64Array(fs), im = new Float64Array(fs); for (let i = 0; i < fs; i++) re[i] = fr[i] * w[i]; fft(re, im, fs);
  const half = fs >> 1, mag = new Float64Array(half); for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  const fMin = Math.round(40 * fs / SR), fMax = Math.round(2000 * fs / SR);
  let bestF = 0, bestA = 0;
  for (let f = fMin; f < Math.min(fMax, half); f++) { if (mag[f] > bestA) { bestA = mag[f]; bestF = f; } }
  if (bestF < 2) return [];
  const freq = bestF * SR / fs;
  const maxNeighbor = Math.max(mag[bestF - 1] || 0, mag[bestF + 1] || 0, 1e-10);
  const conf = Math.min(1, bestA / maxNeighbor * 0.3);
  if (conf < 0.05) return [];
  return [{ freq, conf: Math.min(1, conf) }];
}
function fus(y, pt) {
  if (!y || !y.length) return pt && pt.length ? pt : [];
  if (!pt || !pt.length) return y;
  if (y[0].conf > 0.5) return y;
  const lo = Math.min(y[0].freq, pt[0].freq), hi = Math.max(y[0].freq, pt[0].freq), ratio = hi / lo;
  const sameNote = ratio < 1.08;
  const isHarmonic = sameNote || (Math.round(ratio) > 1 && Math.abs(ratio - Math.round(ratio)) < 0.05);
  if (sameNote) return [{ freq: y[0].conf >= pt[0].conf ? y[0].freq : pt[0].freq, conf: (y[0].conf + pt[0].conf) / 2 }];
  if (isHarmonic && y[0].conf > 0.3) return [{ freq: y[0].freq, conf: (y[0].conf + pt[0].conf) / 2 }];
  return y[0].conf >= pt[0].conf ? y : pt;
}
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function midiName(m) { const n = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; const r = Math.round(m); return n[r % 12] + (Math.floor(r / 12) - 1); }

function detectNotes(signal, minF, maxF, minConf, instrument) {
  const tf = Math.floor((signal.length - 2048) / HOP) + 1;
  const raw = [];
  for (let fi = 0; fi < tf; fi++) {
    const frame = signal.slice(fi * HOP, fi * HOP + 2048);
    const y = yinDetect(frame), pt = peakTrackDetect(frame);
    const det = fus(y, pt);
    if (det.length && det[0].freq > minF && det[0].freq < maxF && det[0].conf > minConf)
      raw.push({ time: fi * HOP / SR, freq: det[0].freq, midi: f2m(det[0].freq), conf: det[0].conf });
  }
  const notes = []; let cur = null, cnt = 0;
  for (const n of raw) {
    const r = Math.round(n.midi);
    if (!cur) { cur = { midi: r, freqSum: n.freq, start: n.time, dur: 0, conf: n.conf, instrument }; cnt = 1; }
    else if (Math.abs(r - cur.midi) <= 1 && n.time - (raw[raw.indexOf(n) - 1]?.time || 0) < 0.1) {
      cur.freqSum += n.freq; cur.conf = Math.max(cur.conf, n.conf); cnt++;
    } else {
      cur.dur = n.time - cur.start; cur.freq = cur.freqSum / cnt;
      if (cur.dur > 0.04) notes.push(cur);
      cur = { midi: r, freqSum: n.freq, start: n.time, dur: 0, conf: n.conf, instrument }; cnt = 1;
    }
  }
  if (cur) { cur.dur = raw.length > 0 ? (raw[raw.length - 1].time + 0.02 - cur.start) : 0.05; if (cur.dur > 0.04) notes.push(cur); }
  return notes;
}

const orig = readWav('jzlg.wav', 200, 10);
function highpass(signal, cutoff) {
  const a = 1 - 2 * Math.PI * cutoff / SR;
  const out = new Float64Array(signal.length); let y = 0;
  for (let i = 1; i < signal.length; i++) { y = signal[i] - signal[i - 1] + a * y; out[i] = y; }
  return out;
}
const hpGuitar = highpass(orig, 200);
const hpBass = highpass(orig, 40);
const bassSig = new Float64Array(orig.length); let ly = 0;
for (let i = 0; i < orig.length; i++) { ly = ly * 0.996 + hpBass[i] * (1 - 0.996); bassSig[i] = ly; }

const guitarNotes = detectNotes(hpGuitar, 200, 1500, 0.2, 'guitar');
const bassNotes = detectNotes(bassSig, 30, 200, 0.15, 'bass');
const allDetected = [...guitarNotes, ...bassNotes].sort((a, b) => a.start - b.start);
console.log(`\nDetected: ${allDetected.length} (${guitarNotes.length} guitar, ${bassNotes.length} bass)`);
process.stderr.write('Detection complete. Matching...\n');

// 3. Match detection vs MIDI
function match(detected, gtNotes, instr) {
  const gtFiltered = gtNotes.filter(n => n.instr === instr);
  let tp = 0, fp = 0, matched = new Set();
  for (const d of detected) {
    const dt = d.start + MIDI_OFFSET; // convert to MIDI time
    const dm = d.midi;
    let found = false;
    for (let gi = 0; gi < gtFiltered.length; gi++) {
      if (matched.has(gi)) continue;
      const g = gtFiltered[gi];
      if (Math.abs(dt - g.time) < 0.2 && Math.abs(dm - 12 * Math.log2(g.freq/440 + 1e-10) - 69) < 1.5) {
        tp++; matched.add(gi); found = true; break;
      }
    }
    if (!found) fp++;
  }
  const fn = gtFiltered.length - matched.size;
  const p = tp / (tp + fp) || 0, r = tp / (tp + fn) || 0;
  return { tp, fp, fn, precision: p, recall: r, f1: 2*p*r/(p+r)||0 };
}

for (const instr of ['guitar', 'bass']) {
  const det = allDetected.filter(n => n.instrument === instr);
  const r = match(det, gt, instr);
  console.log(`\n${instr}:`);
  console.log(`  GT: ${gt.filter(n=>n.instr===instr).length}, Det: ${det.length}`);
  console.log(`  TP=${r.tp} FP=${r.fp} FN=${r.fn}`);
  console.log(`  Prec=${(r.precision*100).toFixed(1)}% Rec=${(r.recall*100).toFixed(1)}% F1=${(r.f1*100).toFixed(1)}%`);

  // Show mismatches (false positives with time info)
  if (det.length > 0) {
    const matchedGt = new Set();
    for (const d of det) {
      const dt = d.start + MIDI_OFFSET;
      const dm = d.midi;
      let found = false;
      for (let gi = 0; gi < gt.length; gi++) {
        if (matchedGt.has(gi)) continue;
        const g = gt[gi];
        if (g.instr === instr && Math.abs(dt - g.time) < 0.2 && Math.abs(dm - 12 * Math.log2(g.freq/440+1e-10)-69) < 1.5) {
          matchedGt.add(gi); found = true; break;
        }
      }
      if (!found) {}
    }
  }
}
}
}
