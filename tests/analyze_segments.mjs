import fs from 'fs';

const SR = 48000, HOP = 1024;

function readWav(path) {
  const buf = fs.readFileSync(path);
  let off = 12, sr, bits, ch, dataOff, frames;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const sz = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { sr = buf.readUInt32LE(off + 12); ch = buf.readUInt16LE(off + 10); bits = buf.readUInt16LE(off + 22); }
    if (id === 'data') { dataOff = off + 8; frames = sz / (bits / 8) / ch; break; }
    off += 8 + sz;
  }
  const bps = bits / 8, mono = new Float64Array(frames);
  for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < ch; c++) s += buf.readInt16LE(dataOff + (i * ch + c) * 2) / 32768; mono[i] = s / ch; }
  return mono;
}

// YIN
function yinDetect(frame, sr) {
  const fs = 2048, mL = Math.ceil(sr / 2000), ML = Math.floor(sr / 40);
  if (frame.length < fs) return [];
  const d = new Float64Array(ML + 1);
  for (let t = 0; t <= ML; t++) { let s = 0; for (let i = 0; i < fs - t; i++) { const dd = frame[i] - frame[i + t]; s += dd * dd; } d[t] = s; }
  const c = new Float64Array(ML + 1); c[0] = 1; let rs = 0;
  for (let t = 1; t <= ML; t++) {
    rs += d[t]; c[t] = rs > 0 ? d[t] * t / rs : 1;
    if (t >= mL && c[t] < 0.15) {
      const a = c[t - 1], b = c[t], cc = c[t + 1];
      const de = a - 2 * b + cc;
      const ft = Math.abs(de) > 1e-12 ? t + (a - cc) / (2 * de) : t;
      return [{ freq: sr / ft, conf: Math.max(0, 1 - c[t]) }];
    }
  }
  return [];
}

// PeakTrack + FFT
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) { for (let j = 0; j < len >> 1; j++) { const u = i + j, v = i + j + (len >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function peakTrackDetect(frame, sr) {
  const fs = 2048;
  if (frame.length < fs) return [];
  const win = new Float64Array(fs);
  for (let i = 0; i < fs; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fs - 1)));
  const re = new Float64Array(fs), im = new Float64Array(fs);
  for (let i = 0; i < fs; i++) re[i] = frame[i] * win[i];
  fft(re, im, fs);
  const half = fs >> 1;
  const mag = new Float64Array(half);
  for (let i = 0; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  const peaks = [];
  for (let i = 2; i < half - 2; i++) {
    if (mag[i] > mag[i - 1] && mag[i] > mag[i - 2] && mag[i] > mag[i + 1] && mag[i] > mag[i + 2]) {
      const a = mag[i - 1], b = mag[i], g = mag[i + 1], de = a - 2 * b + g;
      let fi = i; if (Math.abs(de) > 1e-12) fi = i + (a - g) / (2 * de);
      const f = fi * sr / fs;
      if (f > 30 && f < 8000) peaks.push({ idx: fi, freq: f, amp: mag[i] });
    }
  }
  if (peaks.length === 0) return [];
  peaks.sort((a, b) => b.amp - a.amp);
  const maxAmp = peaks[0].amp;
  const strong = peaks.filter(p => p.amp > maxAmp * 0.05);
  const cands = [];
  for (const p of strong) {
    let hs = 0;
    for (let h = 2; h <= 8; h++) { const hf = p.freq * h; const m = peaks.find(pp => Math.abs(pp.freq - hf) / hf < 0.06 && pp.amp > p.amp * 0.03); if (m) hs += m.amp / maxAmp; }
    let sh = 0;
    for (let h = 2; h <= 6; h++) { const sf = p.freq / h; const m = peaks.find(pp => Math.abs(pp.freq - sf) / sf < 0.06 && pp.amp > p.amp * 0.15); if (m) sh++; }
    const conf = Math.min(1, (hs + sh * 0.5) / 3);
    cands.push({ freq: p.freq, conf });
  }
  cands.sort((a, b) => b.conf - a.conf);
  const res = [];
  for (const c of cands) {
    const dup = res.some(r => { const ratio = c.freq > r.freq ? c.freq / r.freq : r.freq / c.freq; return Math.abs(ratio - Math.round(ratio)) < 0.05; });
    if (!dup && c.conf > 0.15) { res.push({ freq: Math.round(c.freq * 10) / 10, conf: Math.round(c.conf * 100) / 100 }); if (res.length >= 3) break; }
  }
  return res;
}

// Fusion
function gcdFreq(f1, f2) {
  const lo = Math.min(f1, f2), hi = Math.max(f1, f2);
  if (lo < 1) return { gcd: hi, ratio: 1 };
  const ratio = hi / lo, rounded = Math.round(ratio), error = Math.abs(ratio - rounded);
  return { gcd: error < 0.05 ? lo : 1, ratio };
}
function hybridFuse(yin, pt) {
  if (!yin || yin.length === 0) return (pt && pt.length > 0) ? pt[0] : null;
  if (!pt || pt.length === 0) return yin[0];
  if (yin[0].conf > 0.5) return yin[0];
  const gcd = gcdFreq(yin[0].freq, pt[0].freq);
  if (gcd.ratio > 0.95 || pt[0].freq / yin[0].freq >= 2) return { freq: yin[0].freq, conf: (yin[0].conf + pt[0].conf) / 2 };
  return yin[0].conf >= pt[0].conf ? yin[0] : pt[0];
}

function midiName(m) { const n = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; const r = Math.round(m); return n[r % 12] + (Math.floor(r / 12) - 1); }
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }

const segments = [
  { name: 'T1_intro_start', desc: 'Intro arpeggio (0-10s)' },
  { name: 'T2_intro_full', desc: 'Intro full (10-30s)' },
  { name: 'T3_verse1', desc: 'Verse 1 (52-83s)' },
  { name: 'T4_chorus1', desc: 'Chorus 1 (83-103s)' },
  { name: 'T5_solo', desc: 'Guitar solo (200-220s)' },
  { name: 'T6_outro', desc: 'Outro (330-350s)' },
];

console.log('=== Hotel California — 6 Segments (Fusion Detection) ===\n');

for (const seg of segments) {
  const filename = `jzlg_${seg.name}.wav`;
  const samples = readWav(filename);
  const totalFrames = Math.floor((samples.length - 2048) / HOP) + 1;

  const dets = [];
  for (let fi = 0; fi < totalFrames; fi++) {
    const start = fi * HOP;
    const frame = samples.slice(start, start + 2048);
    const y = yinDetect(frame, SR);
    const pt = peakTrackDetect(frame, SR);
    const f = hybridFuse(y, pt);
    if (f) dets.push({ time: start / SR, freq: f.freq, name: midiName(f2m(f.freq)), conf: f.conf });
  }

  const noteCounts = {};
  for (const d of dets) { const m = Math.round(f2m(d.freq)); noteCounts[m] = (noteCounts[m] || 0) + 1; }
  const sorted = Object.entries(noteCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topNotes = sorted.map(([m, c]) => midiName(Number(m)) + '(' + c + 'f)').join(' ');
  const rate = (dets.length / totalFrames * 100).toFixed(1);

  console.log(`${seg.name.padEnd(16)} ${rate}% (${dets.length}/${totalFrames})  ${topNotes}`);
  let prev = '';
  for (let i = 0; i < dets.length; i += 10) {
    const d = dets[i];
    if (d.name !== prev) { console.log(`  ${d.time.toFixed(2)}s ${d.name.padEnd(5)} ${d.freq.toFixed(1)}Hz`); prev = d.name; }
  }
  console.log();
}
