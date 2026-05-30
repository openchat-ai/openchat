import fs from 'fs';

const SR = 48000, HOP = 4096;

function readWav(path, maxSec) {
  const buf = fs.readFileSync(path);
  const dataOffset = buf.readUInt32LE(16) + 8;
  const bits = buf.readUInt16LE(34);
  const bps = bits / 8;
  const ch = buf.readUInt16LE(22);
  const totalFrames = buf.readUInt32LE(40);
  const limit = maxSec ? Math.min(totalFrames, Math.round(maxSec * SR)) : totalFrames;
  const mono = new Float64Array(Math.floor(limit / ch));
  for (let i = 0; i < mono.length && i * ch < limit; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) s += buf.readInt16LE(dataOffset + (i * ch + c) * 2) / 32768;
    mono[i] = s / ch;
  }
  return mono;
}

function yin(frame, sr) {
  const fs = 2048, mL = Math.ceil(sr / 2000), ML = Math.floor(sr / 40);
  if (frame.length < fs) return null;
  const d = new Float64Array(ML + 1);
  for (let t = 0; t <= ML; t++) { let s = 0; for (let i = 0; i < fs - t; i++) { const dd = frame[i] - frame[i + t]; s += dd * dd; } d[t] = s; }
  const c = new Float64Array(ML + 1); c[0] = 1; let rs = 0;
  for (let t = 1; t <= ML; t++) {
    rs += d[t]; c[t] = rs > 0 ? d[t] * t / rs : 1;
    if (t >= mL && c[t] < 0.15) {
      const a = c[t - 1], b = c[t], cc = c[t + 1];
      const de = a - 2 * b + cc;
      const ft = Math.abs(de) > 1e-12 ? t + (a - cc) / (2 * de) : t;
      return { freq: sr / ft, conf: Math.max(0, 1 - c[t]) };
    }
  }
  return null;
}

function midiName(m) {
  const n = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const r = Math.round(m);
  return n[r % 12] + (Math.floor(r / 12) - 1);
}

function f2m(f) { return 12 * Math.log2(f / 440) + 69; }

const samples = readWav('jzlg.wav', 440);
const totalFrames = Math.floor((samples.length - 2048) / HOP);
const step = Math.round(0.5 * SR / HOP);
const history = [];

for (let fi = 0; fi < totalFrames; fi += step) {
  const start = fi * HOP;
  const frame = samples.slice(start, start + 2048);
  const det = yin(frame, SR);
  const time = start / SR;
  if (det && det.conf > 0.3) {
    history.push({ time, freq: det.freq, name: midiName(f2m(det.freq)), midi: f2m(det.freq), conf: det.conf });
  }
}

// 2s chord window
const CHUNK = 2;
const chunks = {};
for (const h of history) {
  const ck = Math.floor(h.time / CHUNK);
  if (!chunks[ck]) chunks[ck] = [];
  chunks[ck].push(Math.round(h.midi) % 12);
}

const classNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
console.log('Song structure (pitch class distribution per 2s):');
for (let ck = 0; ck < Math.ceil(433 / CHUNK); ck++) {
  const notes = chunks[ck] || [];
  const counts = {};
  for (const n of notes) counts[n] = (counts[n] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const top = sorted.map(([p, c]) => classNames[Number(p)] + '(' + c + ')').join(' ');
  const totalSec = ck * CHUNK;
  const min = Math.floor(totalSec / 60), sec = Math.floor(totalSec % 60);
  if (sorted.length > 0) console.log(String(min).padStart(2) + ':' + String(sec).padStart(2, '0') + ' | ' + top);
}
