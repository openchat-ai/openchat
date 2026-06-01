// 和弦 v14：和弦变点检测 + 分段稳态分类
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
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

// 每帧色度
const HP_BIN = Math.round(200 * FFT_SIZE / SR);
const frameChromas = [];
for (let fi = 0; fi < tf; fi++) {
  const c = new Float64Array(12);
  for (let i = HP_BIN; i < HALF; i++) {
    const f = i * SR / FFT_SIZE;
    const pc = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12;
    c[pc] += specHarm[fi][i];
  }
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n;
  frameChromas.push(c);
}

// 色度变化检测（novelty curve）
const smoothFrames = 3; // ~63ms smoothing
const smoothed = [];
for (let fi = 0; fi < tf; fi++) {
  const c = new Float64Array(12);
  let cnt = 0;
  for (let o = -smoothFrames; o <= smoothFrames; o++) { const idx = fi + o; if (idx >= 0 && idx < tf) { for (let i = 0; i < 12; i++) c[i] += frameChromas[idx][i]; cnt++; } }
  if (cnt) for (let i = 0; i < 12; i++) c[i] /= cnt;
  smoothed.push(c);
}

const novelty = [];
for (let fi = 1; fi < tf; fi++) {
  let dot = 0;
  for (let i = 0; i < 12; i++) dot += smoothed[fi - 1][i] * smoothed[fi][i];
  novelty.push(1 - dot); // 变化量 = 1 - 余弦相似度
}

// 找 novelty 峰值（和弦变点）
const maxN = Math.max(...novelty);
const nTh = maxN * 0.4;
const changeFrames = [];
for (let fi = 2; fi < novelty.length - 2; fi++) {
  if (novelty[fi] > nTh && novelty[fi] > novelty[fi - 1] && novelty[fi] > novelty[fi - 2] && novelty[fi] > novelty[fi + 1]) {
    changeFrames.push(fi + 1);
  }
}

// 分段：变点之间的稳态区域
const segments = [];
let segStart = 0;
for (const cf of changeFrames) {
  if (cf - segStart >= 5) segments.push({ start: segStart, end: cf - 1 });
  segStart = cf;
}
if (tf - segStart >= 5) segments.push({ start: segStart, end: tf - 1 });

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
const gtChords = new Array(gtWindows);
for (let w = 0; w < gtWindows; w++) {
  if (!gtActive[w].size) { gtChords[w] = 'N'; continue; }
  const c = new Float64Array(12); for (const n of gtActive[w]) c[((n % 12) + 12) % 12] += 1;
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n;
  gtChords[w] = matchChordChroma(c);
}

console.log('和弦 v14：和弦变点 + 分段稳态\n');

// 对比：固定 500ms 窗 vs 分段稳态
// 固定窗
let fixCor = 0, fixRM = 0, total = 0;
const winFrames = Math.round(WINDOW * SR / HOP);
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') continue; total++;
  const c = new Float64Array(12); let cnt = 0;
  for (let o = 0; o < winFrames && w * winFrames + o < tf; o++) { for (let i = 0; i < 12; i++) c[i] += frameChromas[w * winFrames + o][i]; cnt++; }
  if (cnt) for (let i = 0; i < 12; i++) c[i] /= cnt;
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n;
  const det = matchChordChroma(c);
  if (det === gtChords[w]) fixCor++;
  if (rootOf(det) === rootOf(gtChords[w])) fixRM++;
}
console.log(`固定 500ms 窗: ${(fixCor/total*100||0).toFixed(1)}% (${fixCor}/${total}), 根音=${(fixRM/total*100||0).toFixed(1)}%`);

// 分段稳态
const segChords = segments.map(seg => {
  const c = new Float64Array(12); let cnt = 0;
  for (let fi = seg.start; fi <= seg.end; fi++) { for (let i = 0; i < 12; i++) c[i] += frameChromas[fi][i]; cnt++; }
  if (cnt) for (let i = 0; i < 12; i++) c[i] /= cnt;
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n;
  return { chord: matchChordChroma(c), start: seg.start, end: seg.end };
});

// 按时间覆盖到 GT 窗口
let segCor = 0, segRM = 0, segTotal = 0;
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') continue; segTotal++;
  const wTime = (w + 0.5) * WINDOW; // 窗口中间时间
  const wFrame = Math.round(wTime * SR / HOP);
  // 找该时间属于哪个分段
  const seg = segChords.find(s => wFrame >= s.start && wFrame <= s.end);
  const det = seg ? seg.chord : matchChordChroma(frameChromas[wFrame]);
  if (det === gtChords[w]) segCor++;
  if (rootOf(det) === rootOf(gtChords[w])) segRM++;
}
console.log(`分段稳态: ${(segCor/segTotal*100||0).toFixed(1)}% (${segCor}/${segTotal}), 根音=${(segRM/segTotal*100||0).toFixed(1)}%`);

// 详细输出
console.log(`\n检测到的和弦变点: ${changeFrames.map(f=>(f*HOP/SR).toFixed(2)+'s').join(', ')}`);
console.log(`分段数: ${segments.length}`);
for (let i = 0; i < Math.min(segments.length, 10); i++) {
  const s = segments[i];
  const tStart = (s.start * HOP / SR).toFixed(2);
  const tEnd = (s.end * HOP / SR).toFixed(2);
  console.log(`  seg${i}: ${tStart}-${tEnd}s 检测=${segChords[i].chord}  (${s.end-s.start+1}帧)`);
}

console.log(`\nGT vs 分段检测:`);
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') continue;
  const wFrame = Math.round((w + 0.5) * WINDOW * SR / HOP);
  const seg = segChords.find(s => wFrame >= s.start && wFrame <= s.end);
  const det = seg ? seg.chord : 'N';
  console.log(`  w${w}: GT=${gtChords[w]} D=${det}${det===gtChords[w]?'✅':rootOf(det)===rootOf(gtChords[w])?'🟡':'❌'}`);
}
