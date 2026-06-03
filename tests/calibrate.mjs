// 调校：MIDI ground truth vs 检测结果
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024;
// MIDI absolute time = wavTime + 200
const MIDI_OFFSET = 200; // T5 starts at 200s in the original recording
const T_START = MIDI_OFFSET, T_END = MIDI_OFFSET + 10;

// 1. MIDI ground truth
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const tempo = 60000000 / midi.tracks[0].find(e => e.type === 'setTempo')?.microsecondsPerBeat || 500000;
const spb = tempo / 1000000;
const ppq = midi.header.ticksPerBeat;

const gt = []; // {time, freq, dur, instr}
for (let ti = 1; ti < midi.tracks.length; ti++) { // skip track 0 (metadata)
  const track = midi.tracks[ti];
  let name = '', program = 0;
  for (const e of track) { if (e.type === 'trackName') name = e.text; if (e.type === 'programChange') program = e.programNumber; }
  const instrMap = { 24: 'guitar', 25: 'guitar', 32: 'bass' };
  const instr = instrMap[program] || 'other';
  let tick = 0, actives = {};
  for (const e of track) {
    tick += e.deltaTime || 0;
    const sec = tick / ppq * spb;
    if (sec > T_END) break;
    if (sec < T_START) continue;
    if (e.type === 'noteOn' && e.velocity > 0) {
      if (ti === 6) {
        // Drums: map non-standard notes to drum type
        const drumMap = { 35:'kick',36:'kick',38:'snare',40:'snare',42:'hihat',44:'hihat',46:'hihat',49:'crash',51:'ride',57:'crash' };
        const dType = drumMap[e.noteNumber] || 'hihat';
        gt.push({ time: sec, freq: 0, dur: 0.1, instr: dType, source: 'midi', track: ti, name: `D${e.noteNumber}` });
      } else {
        const freq = 440 * Math.pow(2, (e.noteNumber - 69) / 12);
        actives[e.noteNumber] = { tick, freq };
      }
    }
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      if (actives[e.noteNumber]) {
        const startTick = actives[e.noteNumber].tick;
        const dur = (tick - startTick) / ppq * spb;
        if (dur < 0.05) { delete actives[e.noteNumber]; continue; }
        gt.push({ time: startTick / ppq * spb, freq: actives[e.noteNumber].freq, dur, instr, source: 'midi', track: ti, name });
        delete actives[e.noteNumber];
      }
    }
  }
}
gt.sort((a, b) => a.time - b.time);
console.log(`MIDI ground truth: ${gt.length} notes (${gt.filter(n => n.instr === 'guitar').length} guitar, ${gt.filter(n => n.instr === 'bass').length} bass, ${gt.filter(n => n.instr === 'other').length} other)`);

// 2. Detect notes (same algorithm as exp3)
import LpcMdctCodec from '../bridge/src/core/audio/lmdn-codec.mjs';
// functions from exp3
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

// 3. Run detection
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

// 4. Match detected vs MIDI ground truth (pitch + temporal)
function matchNotes(detected, groundTruth, timeTol = 0.15, halfToneTol = 1.5) {
  let tp = 0, fp = 0, fn = 0;
  const matchedGT = new Set();
  for (const d of detected) {
    const matchIdx = groundTruth.findIndex((g, i) =>
      !matchedGT.has(i) &&
      Math.abs(d.start + MIDI_OFFSET - g.time) < timeTol &&
      Math.abs(d.midi - 12 * Math.log2(g.freq / 440 + 1e-10) - 69) < halfToneTol &&
      d.instrument === g.instr
    );
    if (matchIdx >= 0) { tp++; matchedGT.add(matchIdx); }
    else fp++;
  }
  fn = groundTruth.length - matchedGT.size;
  return { tp, fp, fn, precision: tp / (tp + fp) || 0, recall: tp / (tp + fn) || 0 };
}

// Separate comparison by instrument
for (const instr of ['guitar', 'bass']) {
  const det = allDetected.filter(n => n.instrument === instr);
  const gtNotes = gt.filter(n => n.instr === instr);
  const result = matchNotes(det, gtNotes);
  console.log(`\n${instr}:`);
  console.log(`  GT: ${gtNotes.length}, Detected: ${det.length}`);
  console.log(`  TP=${result.tp} FP=${result.fp} FN=${result.fn}`);
  console.log(`  Precision=${(result.precision*100).toFixed(1)}% Recall=${(result.recall*100).toFixed(1)}%`);

  // Print timing mismatches
  if (gtNotes.length > 0 && det.length > 0) {
    // Align by time
    const aligned = [];
    let di = 0, gi = 0;
    while (di < det.length && gi < gtNotes.length) {
      const dt = det[di].start, gt = gtNotes[gi].time;
      if (Math.abs(dt - gt) < timeTol) {
        const diff = Math.abs(det[di].midi - 12 * Math.log2(gtNotes[gi].freq / 440 + 1e-10) - 69);
        aligned.push({ time: gt, detPitch: det[di].midi, gtFreq: gtNotes[gi].freq, pitchDiff: diff, match: diff < halfToneTol });
        di++; gi++;
      } else if (dt < gt) { di++; } else { gi++; }
    }
    const mismatches = aligned.filter(a => !a.match);
    if (mismatches.length > 0) {
      console.log(`  Pitch mismatches (${mismatches.length}):`);
      mismatches.slice(0, 5).forEach(m => console.log(`    ${m.time.toFixed(2)}s det=${midiName(m.detPitch)} GT=${m.gtFreq.toFixed(0)}Hz diff=${m.pitchDiff.toFixed(1)}st`));
    }
  }
}
