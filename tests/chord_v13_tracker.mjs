// 和弦 v13：V4 跟踪状态机 → 活跃音高色度
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } }
}
function computeMag(s) {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i];
  fft(re, im, FFT_SIZE);
  const m = new Float64Array(HALF); for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); return m;
}

const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHORD_INTS = { '':[0,4,7], 'm':[0,3,7], 'dim':[0,3,6], 'aug':[0,4,8], 'sus2':[0,2,7], 'sus4':[0,5,7], '7':[0,4,7,10], 'm7':[0,3,7,10], 'maj7':[0,4,7,11], 'dim7':[0,3,6,9], 'm7b5':[0,3,6,10], 'aug7':[0,4,8,10] };
function rootOf(n) { return n.replace(/maj|m|dim|aug|sus\d|7|b5/g,'').trim(); }

// === V4 跟踪状态机 ===
const MIN_FRAMES = 2, GAP_FRAMES = 2;

// 读 WAV
const buf = fs.readFileSync('jzlg.wav'); let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

// HP200 + LP 吉他/贝斯通道
const a = 1 - 2 * Math.PI * 200 / SR;
const hp = new Float64Array(mono.length); let y = 0;
for (let i = 1; i < mono.length; i++) { y = mono[i] - mono[i - 1] + a * y; hp[i] = y; }
// 贝斯通道：LP 200Hz + HP 40Hz
const a2 = 1 - 2 * Math.PI * 40 / SR;
const a3 = 1 - 2 * Math.PI * 200 / SR;
const lp = new Float64Array(mono.length); let y2 = 0, y3 = 0;
for (let i = 1; i < mono.length; i++) { y2 = mono[i] - mono[i - 1] + a2 * y2; y3 = y2 - y2 + a3 * y3; lp[i] = y3; }

// 有问题的实现，实际上需要做 LP 滤波
// 简化版本：直接对 mono 做低通
const bass = new Float64Array(mono.length);
const alpha = 0.996; // LP 系数 200Hz
let bacc = 0;
for (let i = 0; i < mono.length; i++) { bacc = mono[i] * (1 - alpha) + bacc * alpha; bass[i] = mono[i] - bacc; }  // 反了，这是 HP

// 正确 LP 40-200Hz
const bassHP = new Float64Array(mono.length); let bhp = 0;
for (let i = 1; i < mono.length; i++) { bhp = mono[i] - mono[i - 1] + a2 * bhp; bassHP[i] = bhp; }
const bassLP = new Float64Array(mono.length); let blp = 0;
for (let i = 1; i < mono.length; i++) { blp = bassHP[i] * (1 - alpha) + blp * alpha; bassLP[i] = mono[i] - blp; }

// 简单点，直接用 HP 作吉他通道，mono-bassHP 作...
// 算了，直接用 HP 跑吉他
const tf = Math.floor((ds - FFT_SIZE) / HOP) + 1;

// === V4 检测器（带跟踪）===
function hpsTop1Frame(mag, sr) {
  const hs = new Float64Array(HALF), ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
  for (let i = 0; i < HALF; i++) { let s = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += mag[idx] * ww[h]; } hs[i] = s; }
  const minB = Math.round(HALF * 40 / sr), maxB = Math.round(HALF * 1500 / sr);
  let bi = minB, bv = 0;
  for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > bv) { bv = hs[i]; bi = i; } }
  if (bv < 1e-10) return null;
  return Math.round(bi * sr / FFT_SIZE * 10) / 10;
}

function runTracker(signal, sr) {
  const tracker = {}; // freq -> {age, gap, snapped}
  const activeAtFrame = []; // [frame_index] -> Set of active freq

  for (let fi = 0; fi < tf; fi++) {
    const frame = signal.slice(fi * HOP, fi * HOP + FFT_SIZE);
    const mag = computeMag(frame);
    const freq = hpsTop1Frame(mag, sr);
    const freqKey = freq ? Math.round(freq * 10) / 10 : null;

    // 更新跟踪器
    for (const key of Object.keys(tracker)) {
      tracker[key].gap++;
      tracker[key].age++;
    }
    if (freqKey) {
      // 合并相近频率
      let matched = null;
      for (const key of Object.keys(tracker)) {
        if (Math.abs(parseFloat(key) - freqKey) / freqKey < 0.03) { matched = key; break; }
      }
      if (matched) {
        tracker[matched].gap = 0;
        tracker[matched].age++;
        // 更新频率为当前值
      } else {
        tracker[freqKey] = { age: 0, gap: 0 };
      }
    }

    // 清除过时
    for (const key of Object.keys(tracker)) {
      if (tracker[key].gap > GAP_FRAMES) delete tracker[key];
    }

    // 当前帧的活跃音
    const active = new Set();
    for (const key of Object.keys(tracker)) {
      if (tracker[key].age >= MIN_FRAMES) active.add(parseFloat(key));
    }
    activeAtFrame.push(active);
  }
  return activeAtFrame;
}

const gTracker = runTracker(hp, SR);

// === GT ===
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

console.log('和弦 v13：V4 跟踪状态机 → 活跃音高\n');

let correct = 0, rootMatch = 0, total = 0; const dets = [];
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') { dets.push('N'); continue; } total++;
  const wStartF = Math.round(w * WINDOW * SR / HOP);
  const wEndF = Math.round((w + 1) * WINDOW * SR / HOP);
  const pcCount = new Float64Array(12);
  for (let fi = wStartF; fi < Math.min(wEndF, gTracker.length); fi++) {
    for (const freq of gTracker[fi]) {
      const midi = f2m(freq);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      pcCount[pc]++;
    }
  }
  const chroma = new Float64Array(12);
  for (let i = 0; i < 12; i++) chroma[i] = pcCount[i];
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  const det = matchChordChroma(chroma);
  dets.push(det);
  if (det === gtChords[w]) correct++;
  if (rootOf(det) === rootOf(gtChords[w])) rootMatch++;
}
const acc = (correct/total*100)||0, rootAcc = (rootMatch/total*100)||0;
console.log(`准确率: ${acc.toFixed(1)}% (${correct}/${total}), 根音: ${rootAcc.toFixed(1)}%`);
console.log(`GT:   ${gtChords.filter(c=>c!=='N').join(' → ')}`);
console.log(`检测: ${dets.filter(d=>d!=='N').join(' → ')}`);

// 每窗口活跃音高
console.log(`\n每窗口活跃音高:`);
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') continue;
  const wStartF = Math.round(w * WINDOW * SR / HOP);
  const wEndF = Math.round((w + 1) * WINDOW * SR / HOP);
  const allPCs = new Set();
  for (let fi = wStartF; fi < Math.min(wEndF, gTracker.length); fi++) {
    for (const freq of gTracker[fi]) {
      const midi = f2m(freq);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      allPCs.add(NOTE[pc]);
    }
  }
  console.log(`  w${w}: [${[...allPCs].join(',')}] GT=${gtChords[w]} D=${dets[w]}${dets[w]===gtChords[w]?'✅':''}`);
}
