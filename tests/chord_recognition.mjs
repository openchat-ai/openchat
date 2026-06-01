// 和弦识别实验：色度 + 模板匹配 + Viterbi
// 目标：不拆音高，只识别和弦级标签
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));

function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function computeChroma(s) {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i]; fft(re, im, FFT_SIZE);
  const mag = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);

  const chroma = new Float64Array(12);
  const minFreq = 60, maxFreq = 4000;

  // 谐波求和色度：每个音高类累加基频 + 2-5 次泛音的能量
  for (let pc = 0; pc < 12; pc++) {
    let energy = 0;
    for (let oct = -1; oct <= 6; oct++) {
      const f0 = 440 * Math.pow(2, (pc + 12 * oct - 69) / 12);
      if (f0 < minFreq) continue;
      if (f0 > maxFreq) break;
      for (let h = 1; h <= 5; h++) {
        const hf = h * f0;
        if (hf < minFreq || hf > maxFreq) continue;
        const bin = Math.round(hf * FFT_SIZE / SR);
        if (bin < 1 || bin >= HALF) continue;
        const w = h === 1 ? 1.0 : Math.pow(0.6, h - 1); // 泛音衰减权重
        energy += mag[bin] * w;
      }
    }
    chroma[pc] = energy;
  }

  let sumSq = 0; for (let i = 0; i < 12; i++) sumSq += chroma[i] * chroma[i];
  const norm = Math.sqrt(sumSq) || 1;
  for (let i = 0; i < 12; i++) chroma[i] /= norm;
  return chroma;
}

// === 和弦模板（24 个大小三和弦） ===
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const templates = {};

// 大三和弦：[1,0,0,0,1,0,0,1,0,0,0,0] 移调
// 小三和弦：[1,0,0,1,0,0,0,1,0,0,0,0] 移调
const majorPattern = [1,0,0,0,1,0,0,1,0,0,0,0];
const minorPattern = [1,0,0,1,0,0,0,1,0,0,0,0];
for (let root = 0; root < 12; root++) {
  const maj = new Float64Array(12); for (let i = 0; i < 12; i++) maj[(root + i) % 12] = majorPattern[i];
  const min = new Float64Array(12); for (let i = 0; i < 12; i++) min[(root + i) % 12] = minorPattern[i];
  let ms = 0, mis = 0; for (let i = 0; i < 12; i++) { ms += maj[i] * maj[i]; mis += min[i] * min[i]; }
  const mn = Math.sqrt(ms) || 1, minn = Math.sqrt(mis) || 1;
  for (let i = 0; i < 12; i++) { maj[i] /= mn; min[i] /= minn; }
  templates[NOTE_NAMES[root] + 'maj'] = maj;
  templates[NOTE_NAMES[root] + 'min'] = min;
}

function matchChord(chroma) {
  let best = '', bestSim = -1;
  for (const [name, tmpl] of Object.entries(templates)) {
    let dot = 0; for (let i = 0; i < 12; i++) dot += chroma[i] * tmpl[i];
    if (dot > bestSim) { bestSim = dot; best = name; }
  }
  return { name: best, sim: bestSim };
}

// === Viterbi 平滑 ===
function viterbiChords(chromaFrames, transitionCost = 0.3) {
  const names = Object.keys(templates);
  const N = names.length, T = chromaFrames.length;
  const dp = new Array(T); const bt = new Array(T);
  for (let t = 0; t < T; t++) { dp[t] = new Float64Array(N); bt[t] = new Int32Array(N); }

  // 第一帧
  const c0 = chromaFrames[0];
  for (let i = 0; i < N; i++) {
    let dot = 0; for (let k = 0; k < 12; k++) dot += c0[k] * templates[names[i]][k];
    dp[0][i] = dot;
  }

  for (let t = 1; t < T; t++) {
    const c = chromaFrames[t];
    for (let i = 0; i < N; i++) {
      let dot = 0; for (let k = 0; k < 12; k++) dot += c[k] * templates[names[i]][k];
      const emit = dot;
      let best = -Infinity, bestJ = 0;
      for (let j = 0; j < N; j++) {
        const cost = dp[t - 1][j] - (j === i ? 0 : transitionCost);
        if (cost > best) { best = cost; bestJ = j; }
      }
      dp[t][i] = emit + best;
      bt[t][i] = bestJ;
    }
  }

  // 回溯
  let last = 0; for (let i = 1; i < N; i++) if (dp[T - 1][i] > dp[T - 1][last]) last = i;
  const path = [last];
  for (let t = T - 1; t > 0; t--) path.unshift(bt[t][path[0]]);
  return path.map(i => names[i]);
}

// === MIDI 和弦 GT ===
function midiChroma(activeNotes) {
  const c = new Float64Array(12);
  for (const n of activeNotes) {
    const pc = ((n % 12) + 12) % 12;
    c[pc] += 1;
  }
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i];
  const norm = Math.sqrt(s) || 1;
  for (let i = 0; i < 12; i++) c[i] /= norm;
  return c;
}

// ===== Main =====
console.log('='.repeat(60));
console.log('和弦识别：色度 + 24 模板 + Viterbi');
console.log('='.repeat(60));

// 1. MIDI 和弦 GT
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;

// 按半秒窗口生成和弦 GT
const totalSec = 433;
const WINDOW = 0.5;
const gtWindows = Math.ceil(totalSec / WINDOW);
const gtChords = new Array(gtWindows);
const gtActive = new Array(gtWindows); for (let i = 0; i < gtWindows; i++) gtActive[i] = new Set();

for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, active = {};
  for (const e of track) {
    tick += e.deltaTime || 0; const sec = tick / ppq * spb;
    if (sec > totalSec) break;
    if (e.type === 'noteOn' && e.velocity > 0) active[e.noteNumber] = sec;
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      if (active[e.noteNumber]) {
        const start = active[e.noteNumber], end = sec;
        const si = Math.floor(start / WINDOW), ei = Math.ceil(end / WINDOW);
        for (let w = si; w < ei && w < gtWindows; w++) gtActive[w].add(e.noteNumber);
        delete active[e.noteNumber];
      }
    }
  }
}

for (let w = 0; w < gtWindows; w++) {
  const chroma = midiChroma([...gtActive[w]]);
  if (gtActive[w].size > 0) {
    const r = matchChord(chroma);
    gtChords[w] = r.name;
  } else {
    gtChords[w] = 'N';
  }
}

// 2. WAV 读取 + 色度提取
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff, sr;
while (off < buf.length) {
  const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4);
  if (id === 'fmt ') sr = buf.readUInt32LE(off + 12);
  if (id === 'data') { dataOff = off + 8; break; }
  off += 8 + sz;
}
const totalSamples = Math.floor((buf.length - dataOff) / 4);

const CHUNK_SEC = 5;
const chunks = Math.ceil(totalSamples / sr / CHUNK_SEC);
const chromaFrames = [];

console.log(`\n[色度提取] ${chunks} 个 chunk...`);
for (let ci = 0; ci < chunks; ci++) {
  const startS = ci * CHUNK_SEC * sr;
  const dur = Math.min(CHUNK_SEC * sr, totalSamples - startS);
  const mono = new Float64Array(dur);
  for (let i = 0; i < dur; i++) { const idx = (startS + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
  const tf = Math.floor((dur - FFT_SIZE) / HOP) + 1;
  for (let fi = 0; fi < tf; fi++) {
    const frame = mono.slice(fi * HOP, fi * HOP + FFT_SIZE);
    chromaFrames.push(computeChroma(frame));
  }
  process.stdout.write(`.`);
}
console.log(`\n  帧数: ${chromaFrames.length}`);

// 3. 逐帧和弦匹配
console.log(`\n[匹配] 逐帧 + Viterbi...`);
const rawChords = chromaFrames.map(c => matchChord(c).name);
const viterbiChords_seq = viterbiChords(chromaFrames, 0.3);

// 4. 和弦变化统计
const rawChanges = [rawChords[0]]; for (let i = 1; i < rawChords.length; i++) if (rawChords[i] !== rawChords[i-1]) rawChanges.push(rawChords[i]);
const vitChanges = [viterbiChords_seq[0]]; for (let i = 1; i < viterbiChords_seq.length; i++) if (viterbiChords_seq[i] !== viterbiChords_seq[i-1]) vitChanges.push(viterbiChords_seq[i]);

console.log(`  原始和弦变化: ${rawChanges.length}`);
console.log(`  Viterbi 和弦变化: ${vitChanges.length}`);

// 5. 与 GT 对比（逐 0.5s 窗口）
const hopSec = HOP / SR; // 21.3ms per frame
const windowFrames = Math.round(WINDOW / hopSec);
const detChords = new Array(gtWindows);

for (let w = 0; w < gtWindows; w++) {
  const fi = Math.round(w * WINDOW / hopSec);
  if (fi < viterbiChords_seq.length) {
    detChords[w] = viterbiChords_seq[fi];
  } else { detChords[w] = 'N'; }
}

let correct = 0, total_c = 0;
const confusion = {};
for (let w = 0; w < gtWindows; w++) {
  const g = gtChords[w], d = detChords[w];
  if (g === 'N') continue; // 跳过无音窗口
  total_c++;
  const key = `${g}->${d}`;
  confusion[key] = (confusion[key] || 0) + 1;
  if (g === d) correct++;
}
const acc = (correct / total_c * 100) || 0;
console.log(`\n  滑动窗口 (${WINDOW}s) 准确率: ${correct}/${total_c} = ${acc.toFixed(1)}%`);

// 6. 输出前三段和弦变化（前 60s）
console.log(`\n--- 前 60 秒和弦变化 ---`);
console.log(`时间\t  GT\t  检测`);
const outLines = [];
for (let w = 0; w < Math.min(120, gtWindows); w++) {
  const t = (w * WINDOW).toFixed(1);
  if (w === 0 || gtChords[w] !== gtChords[w-1] || detChords[w] !== detChords[w-1]) {
    outLines.push(`${t}s\t  ${gtChords[w]}\t  ${detChords[w]}${gtChords[w] === detChords[w] ? '' : '  ✗'}`);
  }
}
console.log(outLines.slice(0, 40).join('\n'));

// 7. 排名 TOP10 混淆
console.log(`\n--- Top10 混淆 ---`);
const sortedConf = Object.entries(confusion).sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [k, v] of sortedConf) console.log(`  ${k}: ${v}`);

// 8. 总统计
console.log(`\n=== 概要 ===`);
console.log(`Chroma 帧数: ${chromaFrames.length}`);
console.log(`原始和弦变化: ${rawChanges.length}`);
console.log(`Viterbi 后: ${vitChanges.length}`);
console.log(`GT 窗口准确率: ${acc.toFixed(1)}%`);
console.log(`GT 窗口 (排除静音): ${total_c}`);
