// 和弦 v15：贝斯变化分段 + ISS 吉他分类
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } }
}
const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHORD_INTS = { '':[0,4,7], 'm':[0,3,7], 'dim':[0,3,6], 'aug':[0,4,8], 'sus2':[0,2,7], 'sus4':[0,5,7], '7':[0,4,7,10], 'm7':[0,3,7,10], 'maj7':[0,4,7,11], 'dim7':[0,3,6,9], 'm7b5':[0,3,6,10], 'aug7':[0,4,8,10] };
function rootOf(n) { return n.replace(/maj|m|dim|aug|sus\d|7|b5/g,'').trim(); }

const eqWeight = new Float64Array(HALF);
const eqPts = [[20,-50],[31.5,-39],[63,-26],[100,-19],[200,-11],[500,-3],[1000,0],[2000,1.5],[3150,0.5],[5000,-2],[6300,-4],[8000,-6],[10000,-10],[12500,-15]];
for (let i = 0; i < HALF; i++) { const f = i * SR / FFT_SIZE; let g = -100; for (let pi = 0; pi < eqPts.length - 1; pi++) if (f >= eqPts[pi][0] && f <= eqPts[pi+1][0]) { const t = (f - eqPts[pi][0]) / (eqPts[pi+1][0] - eqPts[pi][0]); g = eqPts[pi][1] + t * (eqPts[pi+1][1] - eqPts[pi][1]); } eqWeight[i] = Math.pow(10, g / 20); }

const buf = fs.readFileSync('jzlg.wav'); let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

const tf = Math.floor((ds - FFT_SIZE) / HOP) + 1;
const rawSpec = [];
for (let fi = 0; fi < tf; fi++) {
  const frame = mono.slice(fi * HOP, fi * HOP + FFT_SIZE);
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i] * win[i];
  fft(re, im, FFT_SIZE);
  const mag = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * eqWeight[i];
  rawSpec.push(mag);
}
function hpss(spec) { const frames = spec.length, bins = spec[0].length, harm = spec.map(r => new Float64Array(r)), tWin = 7, halfT = Math.floor(tWin / 2); for (let b = 0; b < bins; b++) for (let f = 0; f < frames; f++) { const vals = []; for (let o = -halfT; o <= halfT; o++) { const fi = f + o; if (fi >= 0 && fi < frames) vals.push(spec[fi][b]); } vals.sort((a, b) => a - b); harm[f][b] = vals[Math.floor(vals.length / 2)]; } return harm; }
const specHarm = hpss(rawSpec);

const HP_BIN = Math.round(200 * FFT_SIZE / SR);
const LP_BIN = Math.round(200 * FFT_SIZE / SR);

// === 贝斯音高检测（低音通道 ISS）===
function bassPitches(frame) {
  const mag = new Float64Array(HALF);
  for (let i = 1; i < LP_BIN; i++) mag[i] = frame[i];
  const minB = Math.round(HALF * 30 / SR), maxB = LP_BIN;
  const ww = [0, 1, 0.7, 0.5, 0.3];
  const pits = []; let cur = new Float64Array(mag);
  for (let iter = 0; iter < 3; iter++) {
    const hs = new Float64Array(HALF);
    for (let i = minB; i < maxB; i++) { let s = 0; for (let h = 1; h <= 4; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += cur[idx] * ww[h]; } hs[i] = s; }
    let bi = minB, bv = 0;
    for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > bv) { bv = hs[i]; bi = i; } }
    if (bv < 1e-6) break;
    const f = bi * SR / FFT_SIZE; if (f < 30 || f > 200) break;
    const conf = bv / (cur.reduce((s, v) => s + v, 0) / HALF + 1e-10);
    if (conf < 0.5) break;
    const midi = f2m(f), pc = ((Math.round(midi) % 12) + 12) % 12;
    pits.push({ freq: f, midi, pc, conf });
    for (let h = 1; h <= 8; h++) { const hf = f * h; if (hf > SR/2) break; const hb = Math.round(hf * FFT_SIZE / SR); for (let d = -2; d <= 2; d++) { const b = hb + d; if (b >= 0 && b < HALF) cur[b] = 0; } }
  }
  return pits;
}

// 每帧贝斯根音
const bassPc = [];
for (let fi = 0; fi < tf; fi++) {
  const pits = bassPitches(specHarm[fi]);
  // 取最低的有意义音 = 贝斯根音
  const sorted = pits.sort((a, b) => a.freq - b.freq);
  bassPc.push(sorted.length ? sorted[0].pc : -1);
}

// === 贝斯变化分段 ===
const minSegFrames = Math.round(0.3 / (HOP / SR)); // 最少 300ms 一段
const segStarts = [0];
let lastPc = bassPc[0];
for (let fi = 1; fi < tf; fi++) {
  if (bassPc[fi] !== -1 && lastPc !== -1 && bassPc[fi] !== lastPc) {
    segStarts.push(fi);
  }
  if (bassPc[fi] !== -1) lastPc = bassPc[fi];
}

// 合并太短的分段
const segments = [];
for (let i = 0; i < segStarts.length; i++) {
  const start = segStarts[i];
  const end = (i + 1 < segStarts.length ? segStarts[i + 1] - 1 : tf - 1);
  if (end - start >= minSegFrames || segments.length === 0) {
    segments.push({ start, end });
  } else {
    // 合并到上一个段
    if (segments.length) segments[segments.length - 1].end = end;
  }
}

// === ISS 处理每个分段 ===
function issProcess(mag, sr) {
  const HP = HP_BIN;
  const gMag = new Float64Array(HALF);
  for (let i = HP; i < HALF; i++) gMag[i] = mag[i];
  const minB = Math.round(HALF * 40 / sr), maxB = Math.round(HALF * 1500 / sr);
  const ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
  const pits = []; let cur = new Float64Array(gMag);
  for (let iter = 0; iter < 8; iter++) {
    const hs = new Float64Array(HALF);
    for (let i = minB; i < maxB; i++) { let s = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += cur[idx] * ww[h]; } hs[i] = s; }
    let bi = minB, bv = 0;
    for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i-1] && hs[i] > hs[i+1] && hs[i] > bv) { bv = hs[i]; bi = i; } }
    if (bv < 1e-6) break;
    const f = bi * sr / FFT_SIZE; if (f < 40 || f > 1500) break;
    const conf = bv / (cur.reduce((s, v) => s + v, 0) / HALF + 1e-10);
    if (conf < 0.5) break;
    const midi = f2m(f), pc = ((Math.round(midi) % 12) + 12) % 12;
    const isH = pits.some(p => p.conf >= conf && Math.abs(f / p.freq - Math.round(f / p.freq)) < 0.08 && Math.round(f / p.freq) >= 2);
    const dup = pits.some(p => Math.abs(f2m(p.freq) - midi) < 3);
    if (!dup && !isH) pits.push({ freq: f, midi, pc, conf });
    for (let h = 1; h <= 10; h++) { const hf = f * h; if (hf > sr/2) break; const hb = Math.round(hf * FFT_SIZE / sr); for (let d = -3; d <= 3; d++) { const b = hb + d; if (b >= 0 && b < HALF) cur[b] = 0; } }
  }
  return pits;
}

const allTemplates = {};
for (const [sfx, ints] of Object.entries(CHORD_INTS)) for (let r = 0; r < 12; r++) {
  const shifted = ints.map(d => (r + d) % 12);
  const v = new Float64Array(12); for (const pc of shifted) v[pc] = 1;
  let s = 0; for (let i = 0; i < 12; i++) s += v[i] * v[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
  allTemplates[NOTE[r] + sfx] = v;
}
function matchChordChroma(ch) {
  let best = '', bs = -1;
  for (const [name, v] of Object.entries(allTemplates)) { let dot = 0; for (let i = 0; i < 12; i++) dot += ch[i] * v[i]; if (dot > bs) { bs = dot; best = name; } }
  return best;
}

// 每分段累积谱 → chroma
const segChords = segments.map(seg => {
  const accum = new Float64Array(HALF); let cnt = 0;
  for (let fi = seg.start; fi <= seg.end; fi++) { const m = specHarm[fi]; for (let i = 0; i < HALF; i++) accum[i] += m[i]; cnt++; }
  if (cnt) for (let i = 0; i < HALF; i++) accum[i] /= cnt;
  const pits = issProcess(accum, SR);
  const chroma = new Float64Array(12);
  for (const p of pits) chroma[p.pc] += p.conf;
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return { chord: matchChordChroma(chroma), start: seg.start, end: seg.end, pitches: pits };
});

// === MIDI GT ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000, ppq = midi.header.ticksPerBeat;
const gtWindows = Math.ceil(T5_DUR / WINDOW);
const gtActive = new Array(gtWindows); for (let i = 0; i < gtWindows; i++) gtActive[i] = new Set();
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, ac = {};
  for (const e of track) { tick += e.deltaTime || 0; const sec = tick / ppq * spb; if (sec > T5_START + T5_DUR) break; if (e.type === 'noteOn' && e.velocity > 0) ac[e.noteNumber] = sec; if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) { if (ac[e.noteNumber]) { const si = Math.max(0, Math.floor((ac[e.noteNumber] - T5_START) / WINDOW)); const ei = Math.min(gtWindows, Math.ceil((sec - T5_START) / WINDOW)); for (let w = si; w < ei; w++) gtActive[w].add(e.noteNumber); delete ac[e.noteNumber]; } } }
}
const gtChords = new Array(gtWindows);
for (let w = 0; w < gtWindows; w++) {
  if (!gtActive[w].size) { gtChords[w] = 'N'; continue; }
  const c = new Float64Array(12); for (const n of gtActive[w]) c[((n % 12) + 12) % 12] += 1;
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n;
  gtChords[w] = matchChordChroma(c);
}

console.log('和弦 v15：贝斯分段 + ISS 吉他分类\n');
console.log(`分段数: ${segments.length}`);

// 评估
let cor = 0, rm = 0, total = 0;
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') continue; total++;
  const wFrame = Math.round((w + 0.5) * WINDOW * SR / HOP);
  const seg = segChords.find(s => wFrame >= s.start && wFrame <= s.end);
  const det = seg ? seg.chord : 'N';
  if (det === gtChords[w]) cor++;
  if (rootOf(det) === rootOf(gtChords[w])) rm++;
}
console.log(`准确率: ${(cor/total*100||0).toFixed(1)}% (${cor}/${total}), 根音: ${(rm/total*100||0).toFixed(1)}%`);

console.log(`\n分段详情:`);
for (let i = 0; i < segChords.length; i++) {
  const s = segChords[i];
  const t = (s.start * HOP / SR).toFixed(1) + '-' + (s.end * HOP / SR).toFixed(1) + 's';
  const pitchStr = s.pitches.map(p => `${NOTE[p.pc]}(${(p.freq).toFixed(0)})`).join(',');
  console.log(`  seg${i}: ${t} ${s.chord} 音:[${pitchStr}]`);
}

console.log(`\nGT vs 检测:`);
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') continue;
  const wFrame = Math.round((w + 0.5) * WINDOW * SR / HOP);
  const seg = segChords.find(s => wFrame >= s.start && wFrame <= s.end);
  const det = seg ? seg.chord : 'N';
  const mark = det === gtChords[w] ? '✅' : rootOf(det) === rootOf(gtChords[w]) ? '🟡' : '❌';
  console.log(`  w${w}: GT=${gtChords[w]} D=${det} ${mark}`);
}
