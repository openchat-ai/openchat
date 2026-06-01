import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024;
const T5_START = 200; // MIDI absolute start of T5
const DUR = 10;

// === MIDI ground truth for T5 ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;

const gt = [];
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti];
  let tick = 0, active = {};
  for (const e of track) {
    tick += e.deltaTime || 0;
    const sec = tick / ppq * spb;
    if (e.type === 'noteOn' && e.velocity > 0) {
      active[e.noteNumber] = { tick, freq: 440 * Math.pow(2, (e.noteNumber - 69) / 12) };
    }
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      if (active[e.noteNumber]) {
        const st = active[e.noteNumber].tick / ppq * spb;
        const et = tick / ppq * spb;
        const midiEnd = Math.max(T5_START, Math.min(T5_START + DUR, et));
        const midiStart = Math.max(T5_START, Math.min(T5_START + DUR, st));
        if (midiEnd > midiStart) {
          const instr = ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'other';
          const freq = active[e.noteNumber].freq;
          const midiNum = 12 * Math.log2(freq / 440) + 69;
          const dur = midiEnd - midiStart;
          gt.push({ time: midiStart - T5_START, freq, midi: midiNum, dur, instr, track: ti, name: e.noteNumber });
        }
        delete active[e.noteNumber];
      }
    }
    if (sec > T5_START + DUR && !Object.keys(active).length) break;
  }
}
gt.sort((a, b) => a.time - b.time);
console.log(`MIDI GT: ${gt.length} (${gt.filter(n=>n.instr==='guitar').length}g + ${gt.filter(n=>n.instr==='bass').length}b + ${gt.filter(n=>n.instr==='other').length}o)`);

// === Detection ===
function readWav(path, startSec, durSec) {
  const buf = fs.readFileSync(path);
  let off = 12, dataOff, frames, sr;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') sr = buf.readUInt32LE(off + 12);
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
  const mL = Math.ceil(sr / 2000), ML = Math.floor(sr / 40);
  if (fr.length < fs) return [];
  const d = new Float64Array(ML);
  for (let t = 0; t < ML; t++) { let s = 0; for (let i = 0; i < ML; i++) { const dd = (i < fr.length ? fr[i] : 0) - (i + t < fr.length ? fr[i + t] : 0); s += dd * dd; } d[t] = s; }
  const c = new Float64Array(ML); c[0] = 1; let rs = 0;
  for (let t = 1; t < ML; t++) { rs += d[t]; c[t] = rs > 0 ? d[t] * t / rs : 1; }
  let best = { lag: 0, val: 1 };
  for (let t = mL; t < ML - 1; t++) {
    if (c[t] < c[t - 1] && c[t] < c[t + 1]) {
      if (c[t] < 0.15) {
        const a = c[t - 1], b = c[t], g = c[t + 1], de = a - 2 * b + g;
        const ft = Math.abs(de) > 1e-12 ? t + (a - g) / (2 * de) : t;
        return [{ freq: sr / ft, conf: Math.max(0, 1 - c[t]) }];
      }
      if (c[t] < best.val) best = { lag: t, val: c[t] };
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
  const fs = 2048;
  if (fr.length < fs) return [];
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
function mname(m) { const n = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; const r = Math.round(m); return n[r % 12] + (Math.floor(r / 12) - 1); }

function detect(signal, minF, maxF, minConf, instrument) {
  const tf = Math.floor((signal.length - 2048) / HOP) + 1;
  const out = [];
  for (let fi = 0; fi < tf; fi++) {
    const f = signal.slice(fi * HOP, fi * HOP + 2048);
    const y = yinDetect(f), pt = peakTrackDetect(f);
    const d = fus(y, pt);
    if (d.length) {
      let freq = d[0].freq;
      const half = freq / 2;
      if (half >= minF && half < 1500 && Math.abs(freq / half - 2) < 0.05) freq = half;
      if (freq > minF && freq < maxF && d[0].conf > minConf)
        out.push({ time: fi * HOP / SR, freq, midi: f2m(freq), conf: d[0].conf });
    }
  }
  // Merge sequential same-pitch notes (min 3 frames)
  const MIN_FRAMES = 3;
  const merged = [];
  let cur = null, cnt = 0;
  for (const n of out) {
    const r = Math.round(n.midi);
    if (!cur) { cur = { midi: r, freqSum: n.freq, start: n.time, dur: 0, conf: n.conf, instrument, frames: 1 }; cnt = 1; }
    else if (Math.abs(r - cur.midi) <= 1 && n.time - cur.start - cur.dur < 0.1) {
      cur.freqSum += n.freq; cur.conf = Math.max(cur.conf, n.conf); cur.frames++; cur.dur = n.time - cur.start; cnt++;
    } else {
      cur.freq = cur.freqSum / cnt;
      if (cur.frames >= MIN_FRAMES && cur.dur > 0.04) merged.push(cur);
      cur = { midi: r, freqSum: n.freq, start: n.time, dur: 0, conf: n.conf, instrument, frames: 1 }; cnt = 1;
    }
  }
  if (cur) { cur.freq = cur.freqSum / cnt; cur.dur = out.length > 0 ? out[out.length-1].time + 0.02 - cur.start : 0.05; if (cur.frames >= MIN_FRAMES && cur.dur > 0.04) merged.push(cur); }
  return merged;
}

const orig = readWav('jzlg.wav', 200, 10);
function highpass(s, c) { const a = 1 - 2 * Math.PI * c / SR; const o = new Float64Array(s.length); let y = 0; for (let i = 1; i < s.length; i++) { y = s[i] - s[i-1] + a * y; o[i] = y; } return o; }
const hpG = highpass(orig, 80);
const hpB = highpass(orig, 20);
const bassLP = Math.exp(-2 * Math.PI * 200 / SR);
const bSig = new Float64Array(orig.length); let ly = 0;
for (let i = 0; i < orig.length; i++) { ly = ly * bassLP + hpB[i] * (1 - bassLP); bSig[i] = ly; }

function correctOctave(freq, minF) {
  const half = freq / 2;
  if (half >= minF && half < 1500 && Math.abs(freq / half - 2) < 0.05) return half;
  return freq;
}
console.log('Detecting guitar...');
const gNotes = detect(hpG, 80, 1500, 0.2, 'guitar');
console.log('Detecting bass...');
const bNotes = detect(bSig, 40, 180, 0.15, 'bass');
const all = [...gNotes, ...bNotes].sort((a, b) => a.start - b.start);
console.log(`Detected: ${all.length} (${gNotes.length}g + ${bNotes.length}b)`);

// === Compare ===
function compare(det, gtList, instr) {
  const gtf = gtList.filter(n => n.instr === instr);
  let tp = 0, fp = 0, matched = new Set();
  for (const d of det) {
    let found = false;
    for (let gi = 0; gi < gtf.length; gi++) {
      if (matched.has(gi)) continue;
      const g = gtf[gi];
      if (Math.abs(d.start - g.time) < 0.15 && Math.abs(d.midi - g.midi) < 1.5) {
        tp++; matched.add(gi); found = true; break;
      }
    }
    if (!found) fp++;
  }
  const fn = gtf.length - matched.size;
  const p = tp / (tp + fp) || 0, r = tp / (tp + fn) || 0;
  return { tp, fp, fn, precision: p, recall: r, f1: 2 * p * r / (p + r) || 0 };
}

for (const instr of ['guitar', 'bass']) {
  const d = all.filter(n => n.instrument === instr);
  const r = compare(d, gt, instr);
  console.log(`\n${instr}: GT=${gt.filter(n=>n.instr===instr).length} Det=${d.length} TP=${r.tp} FP=${r.fp} FN=${r.fn} Prec=${(r.precision*100).toFixed(1)}% Rec=${(r.recall*100).toFixed(1)}% F1=${(r.f1*100).toFixed(1)}%`);
}

// Octave error analysis
console.log('\n=== Octave error analysis (guitar) ===');
const gDet = all.filter(n => n.instrument === 'guitar');
const gGt = gt.filter(n => n.instr === 'guitar');
let octOk = 0, octUp1 = 0, octUp2 = 0, other = 0;
for (const d of gDet) {
  // find closest GT
  const c = gGt.reduce((b, g) => Math.abs(d.start - g.time) < Math.abs(d.start - (b?.time || -999)) ? g : b, null);
  if (c && Math.abs(d.start - c.time) < 0.3) {
    const diff = d.midi - c.midi;
    if (Math.abs(diff) < 1.5) octOk++;
    else if (diff > 10 && diff < 14) octUp1++;
    else if (diff > 22 && diff < 26) octUp2++;
    else other++;
  }
}
console.log(`Correct: ${octOk}, +1oct: ${octUp1}, +2oct: ${octUp2}, other: ${other}`);
