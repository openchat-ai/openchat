// 实验三 V3 MIDI 校准：帧间累积 + 多窗口 FFT vs MIDI GT
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024;

const winCache = {};
function getWin(n) { if (!winCache[n]) { winCache[n] = new Float64Array(n); for (let i = 0; i < n; i++) winCache[n][i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / n)); } return winCache[n]; }

function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function computeMag(s, fftSize) {
  const win = getWin(fftSize), half = fftSize >> 1;
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize);
  for (let i = 0; i < Math.min(s.length, fftSize); i++) re[i] = s[i] * win[i]; fft(re, im, fftSize);
  const m = new Float64Array(half); for (let i = 0; i < half; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); return m;
}

function hpsDetect(s, sr, fftSize) {
  const half = fftSize >> 1;
  const m = computeMag(s, fftSize), hs = new Float64Array(half), ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
  for (let i = 0; i < half; i++) { let ss = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= half) break; ss += m[idx] * ww[h]; } hs[i] = ss; }
  const minB = Math.round(half * 40 / sr), maxB = Math.round(half * 1500 / sr);
  const peaks = []; let mPV = 0; for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > 0) { peaks.push({ i, v: hs[i] }); if (hs[i] > mPV) mPV = hs[i]; } }
  if (!peaks.length) return []; const flt = peaks.filter(p => p.v >= mPV * 0.3).sort((a, b) => b.v - a.v); const r = [];
  for (const p of flt) { const fq = p.i * sr / fftSize; const dup = r.some(r2 => Math.abs(fq / r2.freq - Math.round(fq / r2.freq)) < 0.08); if (!dup) { r.push({ freq: Math.round(fq * 10) / 10, conf: Math.min(1, p.v / mPV) }); if (r.length >= 3) break; } }
  return r;
}
function yinDetect(s, sr, fftSize) {
  const maxLag = Math.round(sr / 40), minLag = Math.round(sr / 2000);
  const buf = s.length < fftSize ? (() => { const b = new Float64Array(fftSize); b.set(s); return b; })() : s.slice(0, fftSize);
  const diff = new Float64Array(maxLag); for (let tau = 0; tau < maxLag; tau++) { let d = 0; for (let i = 0; i < maxLag; i++) { const dd = buf[i] - buf[i + tau]; d += dd * dd; } diff[tau] = d; }
  const cm = new Float64Array(maxLag); cm[0] = 1; let rs = 0; for (let tau = 1; tau < maxLag; tau++) { rs += diff[tau]; cm[tau] = rs > 0 ? diff[tau] * tau / rs : 1; }
  let bl = 0, bv = 1; for (let tau = Math.max(minLag, 2); tau < maxLag; tau++) { if (cm[tau] < cm[tau - 1] && cm[tau] < cm[tau + 1]) { if (cm[tau] < 0.15) { bl = tau; bv = cm[tau]; break; } if (cm[tau] < bv) { bl = tau; bv = cm[tau]; } } }
  if (bl < minLag) return []; let rf = bl; if (bl > 0 && bl < maxLag - 1) { const a = cm[bl - 1], b = cm[bl], g = cm[bl + 1], de = a - 2 * b + g; if (Math.abs(de) > 1e-12) rf = bl + (a - g) / (2 * de); }
  const freq = sr / rf; const cf = Math.max(0, 1 - bv); if (freq > 2000 || freq < 30) return []; return [{ freq: Math.round(freq * 10) / 10, conf: Math.round(cf * 100) / 100 }];
}
function multiPeakTrack(s, sr, fftSize) {
  const half = fftSize >> 1;
  const m = computeMag(s, fftSize), peaks = [];
  for (let i = 2; i < half - 2; i++) { if (m[i] > m[i - 1] && m[i] > m[i - 2] && m[i] > m[i + 1] && m[i] > m[i + 2]) { const a = m[i - 1], b = m[i], g = m[i + 1], de = a - 2 * b + g; let fi = i; if (Math.abs(de) > 1e-12) fi = i + (a - g) / (2 * de); peaks.push({ freq: fi * sr / fftSize, amp: b }); } }
  if (!peaks.length) return []; const ma = peaks.reduce((mm, p) => Math.max(mm, p.amp), 0);
  const f = peaks.filter(p => p.amp >= ma * 0.05 && p.freq >= 40 && p.freq <= 2000).sort((a, b) => b.amp - a.amp);
  const r = [], uf = []; for (const p of f) { const ih = uf.some(fq => { const rr = p.freq / fq; return rr > 1.5 && Math.abs(rr - Math.round(rr)) < 0.08; }); if (!ih) { r.push({ freq: Math.round(p.freq * 10) / 10, conf: Math.min(1, p.amp / ma) }); uf.push(p.freq); if (r.length >= 3) break; } }
  return r;
}
function fusionDetect(s, sr, fftSize) {
  const h = hpsDetect(s, sr, fftSize), y = yinDetect(s, sr, fftSize), p = multiPeakTrack(s, sr, fftSize);
  const all = [...h.map(n => ({ ...n, src: 'hps' })), ...y.map(n => ({ ...n, src: 'yin' })), ...p.map(n => ({ ...n, src: 'peak' }))];
  if (!all.length) return []; const cls = [];
  for (const note of all) { let found = false; for (const cl of cls) { const ratio = note.freq > cl.avg ? note.freq / cl.avg : cl.avg / note.freq; if (ratio < 1.03) { cl.notes.push(note); cl.avg = cl.notes.reduce((s, n) => s + n.freq, 0) / cl.notes.length; found = true; break; } } if (!found) cls.push({ notes: [note], avg: note.freq }); }
  const ww = { yin: 1, peak: 0.8, hps: 0.5 }, r = [];
  for (const cl of cls) { let wc = 0, tw = 0; const ss = new Set(); for (const note of cl.notes) { const w = ww[note.src] || 0.5; wc += note.conf * w; tw += w; ss.add(note.src); } const ac = tw > 0 ? wc / tw : 0; const bonus = ss.size > 1 ? 0.1 * (ss.size - 1) : 0; r.push({ freq: Math.round(cl.avg * 10) / 10, conf: Math.min(1, ac + bonus), srcCount: ss.size }); }
  r.sort((a, b) => b.conf - a.conf); return r.slice(0, 3);
}

function verifyCandidate(frameMag, freq, sr, fftSize) {
  const half = fftSize >> 1;
  const f0Bin = Math.round(freq * fftSize / sr);
  if (f0Bin < 3 || f0Bin >= half - 3) return 0;
  const f0E = frameMag[f0Bin]; if (f0E < 1e-8) return 0;
  const localSum = frameMag[f0Bin - 2] + frameMag[f0Bin - 1] + frameMag[f0Bin] + frameMag[f0Bin + 1] + frameMag[f0Bin + 2];
  const prominence = f0E / Math.max((localSum - f0E) / 4, 1e-10);
  let score = 0;
  if (prominence > 1.8) score += 0.25; else if (prominence > 1.3) score += 0.1;
  let harmScore = 0;
  for (let k = 2; k <= 5; k++) { const hb = Math.round(k * freq * fftSize / sr); if (hb >= half) break; const le = (frameMag[hb - 1] + frameMag[hb] + frameMag[hb + 1]) / 3; const maxExpected = f0E / k; if (le > maxExpected * 0.15) harmScore++; if (le > maxExpected * 0.5) harmScore++; }
  score += Math.min(0.4, harmScore * 0.05);
  for (let div = 2; div <= 4; div++) { const subFreq = freq / div; if (subFreq < 40) continue; const sb = Math.round(subFreq * fftSize / sr); if (sb >= 3 && sb < half - 3) { const subE = (frameMag[sb - 1] + frameMag[sb] + frameMag[sb + 1]) / 3; if (subE > f0E * 0.4) { score -= 0.25; break; } } }
  let noiseCount = 0; for (let d = -5; d <= 5; d++) { if (d === 0) continue; const bi = f0Bin + d; if (bi > 0 && bi < half && frameMag[bi] > f0E * 0.3) noiseCount++; }
  if (noiseCount > 6) score -= 0.15;
  return Math.max(0, Math.min(1, score));
}

function detectChannel(signal, offset, minF, maxF, minConf, instrument, fftSize) {
  const a = 1 - 2 * Math.PI * (instrument === 'guitar' ? 200 : 40) / SR;
  const hp = new Float64Array(signal.length); let y = 0;
  for (let i = 1; i < signal.length; i++) { y = signal[i] - signal[i - 1] + a * y; hp[i] = y; }
  const sig = instrument === 'bass' ? (() => { const o = new Float64Array(signal.length); let ly = 0; for (let i = 0; i < signal.length; i++) { ly = ly * 0.996 + hp[i] * (1 - 0.996); o[i] = ly; } return o; })() : hp;

  const tf = Math.floor((sig.length - fftSize) / HOP) + 1;
  const active = {}, notes = [], GAP = 0.05;

  for (let fi = 0; fi < tf; fi++) {
    const frame = sig.slice(fi * HOP, fi * HOP + fftSize);
    const dets = fusionDetect(frame, SR, fftSize);
    for (const d of dets) {
      if (d.freq < minF || d.freq > maxF) continue;
      const rawFrame = signal.slice(fi * HOP, fi * HOP + fftSize);
      const rawMag = computeMag(rawFrame, fftSize);
      const vScore = verifyCandidate(rawMag, d.freq, SR, fftSize);
      const adjConf = d.conf * (0.4 + 0.6 * vScore);
      const time = offset + fi * HOP / SR;

      if (adjConf > minConf * 0.2) {
        const r = Math.round(f2m(d.freq));
        if (active[r] && time - active[r].last <= GAP) {
          active[r].count++; active[r].freqSum += d.freq; active[r].last = time;
          active[r].cumConf = active[r].cumConf * 0.7 + adjConf * 0.3;
          if (adjConf > active[r].peakConf) active[r].peakConf = adjConf;
        } else {
          if (active[r] && active[r].count >= 2 && active[r].last - active[r].start > 0.04 && active[r].peakConf > minConf) {
            notes.push({ midi: parseInt(r), freq: active[r].freqSum / active[r].count, start: active[r].start, dur: active[r].last - active[r].start, conf: active[r].peakConf, instrument });
          }
          active[r] = { freqSum: d.freq, start: time, last: time, count: 1, cumConf: adjConf, peakConf: adjConf };
        }
      }
    }
  }
  for (const [r, a] of Object.entries(active)) {
    if (a.count >= 2 && a.last - a.start > 0.04 && a.peakConf > minConf) {
      notes.push({ midi: parseInt(r), freq: a.freqSum / a.count, start: a.start, dur: a.last - a.start, conf: a.peakConf, instrument });
    }
  }
  return notes;
}

// === MIDI GT ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;

const gt = [];
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, active = {};
  for (const e of track) { tick += e.deltaTime || 0; const sec = tick / ppq * spb; if (sec > 432) break; if (e.type === 'noteOn' && e.velocity > 0) { active[e.noteNumber] = { tick, freq: 440 * Math.pow(2, (e.noteNumber - 69) / 12) }; } if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) { if (active[e.noteNumber]) { const st = active[e.noteNumber].tick / ppq * spb; const et = tick / ppq * spb; const instr = ti <= 3 ? 'guitar' : ti === 4 ? 'bass' : 'other'; gt.push({ time: st, freq: active[e.noteNumber].freq, midi: 12 * Math.log2(active[e.noteNumber].freq / 440) + 69, dur: et - st, instr }); delete active[e.noteNumber]; } } }
}
gt.sort((a, b) => a.time - b.time);
const gtG = gt.filter(n => n.instr === 'guitar');
const gtB = gt.filter(n => n.instr === 'bass');
console.log(`MIDI GT: ${gt.length} (guitar:${gtG.length} bass:${gtB.length} other:${gt.filter(n=>n.instr==='other').length})`);

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff, sr;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'fmt ') sr = buf.readUInt32LE(off + 12); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const totalFrames = Math.floor((buf.length - dataOff) / 4);

function readChunk(ci) {
  const start = ci * 10 * sr, dur = Math.min(10 * sr, totalFrames - start);
  const mono = new Float64Array(dur);
  for (let i = 0; i < dur; i++) { const idx = (start + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
  return { mono, offset: start / sr, dur: dur / sr };
}

// === Match (same window as exp2) ===
function matchChunk(det, gtList, startTime, endTime) {
  const gw = gtList.filter(g => g.time >= startTime - 0.5 && g.time < endTime + 0.5);
  const dw = det.filter(d => d.start >= startTime && d.start < endTime);
  let tp = 0, fp = 0, matched = new Set();
  for (const d of dw) { let found = false; for (let gi = 0; gi < gw.length; gi++) { if (matched.has(gi)) continue; const g = gw[gi]; if (Math.abs(d.start - g.time) < 0.15 && Math.abs(d.midi - g.midi) < 1.5) { tp++; matched.add(gi); found = true; break; } } if (!found) fp++; }
  return { tp, fp, fn: gw.length - matched.size, det: dw.length, gt: gw.length };
}

// === Run ===
const chunks = Math.ceil(totalFrames / sr / 10);
console.log(`\nRunning enhanced V3 detection...`);
console.log(`Git: FFT=2048  Bass: FFT=4096  Cumulative conf: yes`);
let total = { guitar: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 }, bass: { tp: 0, fp: 0, fn: 0, det: 0, gt: 0 } };
const t0 = Date.now();

for (let ci = 0; ci < chunks; ci++) {
  const { mono, offset, dur } = readChunk(ci); const end = offset + dur;
  process.stdout.write(`\r  Chunk ${ci+1}/${chunks} (${offset.toFixed(0)}-${end.toFixed(0)}s)`);
  const g = detectChannel(mono, offset, 80, 1500, 0.2, 'guitar', 2048);
  const b = detectChannel(mono, offset, 40, 180, 0.15, 'bass', 4096);
  const gr = matchChunk(g, gtG, offset, end);
  const br = matchChunk(b, gtB, offset, end);
  total.guitar.tp += gr.tp; total.guitar.fp += gr.fp; total.guitar.fn += gr.fn; total.guitar.det += gr.det; total.guitar.gt += gr.gt;
  total.bass.tp += br.tp; total.bass.fp += br.fp; total.bass.fn += br.fn; total.bass.det += br.det; total.bass.gt += br.gt;
}

console.log(`\n  Done in ${((Date.now()-t0)/1000).toFixed(0)}s`);

// === Print ===
console.log(`\n${'='.repeat(60)}`);
console.log(`V3 MIDI Calibration Results`);
console.log(`Features: verifyCandidate + cross-frame accumulation + multi-window FFT`);
console.log(`${'='.repeat(60)}`);

// Compare with exp2 baseline
const baseline = { guitar: { tp: 894, fp: 4871, fn: 3035 }, bass: { tp: 299, fp: 4128, fn: 590 } };

for (const instr of ['guitar', 'bass']) {
  const t = total[instr];
  const p = t.tp / (t.tp + t.fp) || 0, r = t.tp / (t.tp + t.fn) || 0;
  const f1 = 2 * p * r / (p + r || 1) * 100;
  const b = baseline[instr];
  const bp = b.tp / (b.tp + b.fp) || 0, br = b.tp / (b.tp + b.fn) || 0;
  const bf1 = 2 * bp * br / (bp + br || 1) * 100;
  console.log(`\n${instr.toUpperCase()}:`);
  console.log(`  GT=${t.gt}  Det=${t.det}  TP=${t.tp}  FP=${t.fp}  FN=${t.fn}`);
  console.log(`  Prec= ${(p*100).toFixed(1)}%  Rec= ${(r*100).toFixed(1)}%  F1= ${f1.toFixed(1)}%`);
  console.log(`  vs baseline: Prec ${bp.toFixed(3)}->${p.toFixed(3)}  Rec ${br.toFixed(3)}->${r.toFixed(3)}  F1 ${bf1.toFixed(1)}->${f1.toFixed(1)}`);
}
