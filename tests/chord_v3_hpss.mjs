// 和弦识别 v3：HPSS + 等响度加权 + 累积窗
// 仅 T5 段 (10s) 快速迭代
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));

function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}

// ========== 1. 等响度加权（ISO 226:2003 简化 60 phon 插值） ==========
const eqWeight = new Float64Array(HALF);
// 定义关键频率点的 dB 增益
const eqPts = [
  [20, -50], [31.5, -39], [63, -26], [100, -19], [200, -11],
  [500, -3], [1000, 0], [2000, 1.5], [3150, 0.5], [5000, -2],
  [6300, -4], [8000, -6], [10000, -10], [12500, -15]
];
for (let i = 0; i < HALF; i++) {
  const f = i * SR / FFT_SIZE;
  let gain = -100;
  for (let pi = 0; pi < eqPts.length - 1; pi++) {
    if (f >= eqPts[pi][0] && f <= eqPts[pi + 1][0]) {
      const t = (f - eqPts[pi][0]) / (eqPts[pi + 1][0] - eqPts[pi][0]);
      gain = eqPts[pi][1] + t * (eqPts[pi + 1][1] - eqPts[pi][1]);
    }
  }
  eqWeight[i] = Math.pow(10, gain / 20); // dB → 线性
}

// ========== 2. HPSS（中值滤波，水平 = 谐波，垂直 = 打击） ==========
function hpss(spectrogram) {
  const frames = spectrogram.length, bins = spectrogram[0].length;
  const harm = spectrogram.map(row => new Float64Array(row));

  // 沿时间轴中值滤波（保留水平条纹 = 谐波）
  const tWin = 7; // 约 150ms
  const halfT = Math.floor(tWin / 2);
  for (let b = 0; b < bins; b++) {
    for (let f = 0; f < frames; f++) {
      const vals = [];
      for (let o = -halfT; o <= halfT; o++) {
        const fi = f + o;
        if (fi >= 0 && fi < frames) vals.push(spectrogram[fi][b]);
      }
      vals.sort((a, b) => a - b);
      harm[f][b] = vals[Math.floor(vals.length / 2)];
    }
  }
  return harm;
}

// ========== 3. 累积窗色度（200ms） ==========
function chromaFromSpectrum(mag, binStart, binEnd) {
  const chroma = new Float64Array(12);
  for (let i = binStart; i < Math.min(binEnd, HALF); i++) {
    const freq = i * SR / FFT_SIZE;
    const midi = 12 * Math.log2(freq / 440) + 69;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += mag[i];
  }
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return chroma;
}

// ========== 和弦模板（24 个大小三和弦） ==========
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const templates = {};
const majorPattern = [1,0,0,0,1,0,0,1,0,0,0,0];
const minorPattern = [1,0,0,1,0,0,0,1,0,0,0,0];
for (let r = 0; r < 12; r++) {
  for (const [q, pat] of [['maj', majorPattern], ['min', minorPattern]]) {
    const v = new Float64Array(12); let sum = 0;
    for (let i = 0; i < 12; i++) { v[(r + i) % 12] = pat[i]; sum += pat[i] * pat[i]; }
    const n = Math.sqrt(sum); for (let i = 0; i < 12; i++) v[i] /= n;
    templates[NOTE_NAMES[r] + q] = v;
  }
}

function matchChord(chroma) {
  let best = '', bestSim = -1;
  for (const [name, tmpl] of Object.entries(templates)) {
    let dot = 0; for (let i = 0; i < 12; i++) dot += chroma[i] * tmpl[i];
    if (dot > bestSim) { bestSim = dot; best = name; }
  }
  return best;
}

// ========== MIDI GT ==========
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;

const WINDOW = 0.5;
const gtWindows = Math.ceil(T5_DUR / WINDOW);
const gtChords = new Array(gtWindows);
const gtActive = new Array(gtWindows);
for (let i = 0; i < gtWindows; i++) gtActive[i] = new Set();

for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, active = {};
  for (const e of track) {
    tick += e.deltaTime || 0; const sec = tick / ppq * spb;
    if (sec > T5_START + T5_DUR) break;
    if (e.type === 'noteOn' && e.velocity > 0) active[e.noteNumber] = sec;
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      if (active[e.noteNumber]) {
        const st = active[e.noteNumber], en = sec;
        const si = Math.max(0, Math.floor((st - T5_START) / WINDOW));
        const ei = Math.min(gtWindows, Math.ceil((en - T5_START) / WINDOW));
        for (let w = si; w < ei; w++) gtActive[w].add(e.noteNumber);
        delete active[e.noteNumber];
      }
    }
  }
}
function midiChroma(notes) {
  const c = new Float64Array(12);
  for (const n of notes) c[((n % 12) + 12) % 12] += 1;
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i];
  const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n;
  return c;
}
for (let w = 0; w < gtWindows; w++) {
  if (gtActive[w].size > 0) gtChords[w] = matchChord(midiChroma([...gtActive[w]]));
  else gtChords[w] = 'N';
}

// ========== WAV 读取 ==========
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) {
  const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4);
  if (id === 'data') { dataOff = off + 8; break; }
  off += 8 + sz;
}
const startSample = Math.round(T5_START * SR);
const durSamples = Math.round(T5_DUR * SR);
const mono = new Float64Array(durSamples);
for (let i = 0; i < durSamples; i++) { const idx = (startSample + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

console.log(`T5 段 (${T5_START}-${T5_START+T5_DUR}s)`);

// ========== 改进的方法 ==========
// 构建频谱图
const tf = Math.floor((durSamples - FFT_SIZE) / HOP) + 1;
const spec = [];
for (let fi = 0; fi < tf; fi++) {
  const frame = mono.slice(fi * HOP, fi * HOP + FFT_SIZE);
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i] * win[i];
  fft(re, im, FFT_SIZE);
  const mag = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  // 等响度加权
  for (let i = 0; i < HALF; i++) mag[i] *= eqWeight[i];
  spec.push(mag);
}

const specHarm = hpss(spec);

// 测试三种窗口
const WIN_SIZES = [0.05, 0.2, 0.5];
for (const winSec of WIN_SIZES) {
  const winFrames = Math.round(winSec * SR / HOP);
  const accumChroma = [];
  for (let fi = 0; fi < tf; fi += winFrames) {
    const chroma = new Float64Array(12);
    let count = 0;
    for (let o = 0; o < winFrames && fi + o < tf; o++) {
      const c = chromaFromSpectrum(specHarm[fi + o], 1, HALF);
      for (let i = 0; i < 12; i++) chroma[i] += c[i];
      count++;
    }
    if (count > 0) { for (let i = 0; i < 12; i++) chroma[i] /= count; }
    let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
    const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
    accumChroma.push(chroma);
  }

  let correct = 0, total = 0;
  const detSeq = [];
  for (let w = 0; w < gtWindows; w++) {
    if (gtChords[w] === 'N') continue;
    total++;
    const accIdx = Math.floor(w * WINDOW / winSec);
    const d = accIdx < accumChroma.length ? matchChord(accumChroma[accIdx]) : 'N';
    detSeq.push(d);
    if (d === gtChords[w]) correct++;
  }
  const acc = (correct / total * 100) || 0;
  const gtSeq = gtChords.filter(c => c !== 'N');
  console.log(`\n累积窗 ${winSec}s: ${acc.toFixed(1)}% (${correct}/${total})`);
  console.log(`  GT:  ${gtSeq.join(' → ')}`);
  console.log(`  检测: ${detSeq.join(' → ')}`);
}
