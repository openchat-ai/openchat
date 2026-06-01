// 和弦识别 v2：用贝斯根音约束 + 谐波色度
// 仅处理 T5 段 (10s) 快速迭代
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10; // 秒

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));

function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}

function getBassChroma(s) {
  // 低通 + 440Hz 以下色度（主要捕捉贝斯和吉他低音弦的基频）
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i]; fft(re, im, FFT_SIZE);
  const chroma = new Float64Array(12);
  for (let i = 1; i < HALF; i++) {
    const freq = i * SR / FFT_SIZE;
    if (freq < 40 || freq > 440) continue;
    const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    const midi = 12 * Math.log2(freq / 440) + 69;
    const pc = ((Math.round(midi) % 12) + 12) % 12;
    chroma[pc] += mag;
  }
  let ss = 0; for (let i = 0; i < 12; i++) ss += chroma[i] * chroma[i];
  const n = Math.sqrt(ss) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return chroma;
}

function getFullChroma(s) {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i]; fft(re, im, FFT_SIZE);
  const mag = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);

  // 仅 60-1000Hz，避免高频噪声
  const chroma = new Float64Array(12);
  for (let pc = 0; pc < 12; pc++) {
    let energy = 0;
    for (let oct = 0; oct <= 4; oct++) {
      const f0 = 440 * Math.pow(2, (pc + 12 * oct - 69) / 12);
      if (f0 < 60 || f0 > 1000) continue;
      // 只累加基频 (h=1)，不做泛音求和
      const bin = Math.round(f0 * FFT_SIZE / SR);
      if (bin > 0 && bin < HALF) energy += mag[bin];
    }
    chroma[pc] = energy;
  }
  let sum = 0; for (let i = 0; i < 12; i++) sum += chroma[i] * chroma[i];
  const n = Math.sqrt(sum) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return chroma;
}

// === 和弦模板 ===
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const templates = {};
const majorPattern = [1,0,0,0,1,0,0,1,0,0,0,0];
const minorPattern = [1,0,0,1,0,0,0,1,0,0,0,0];
for (let r = 0; r < 12; r++) {
  for (const [q, pat] of [['maj', majorPattern], ['min', minorPattern]]) {
    const v = new Float64Array(12); let s2 = 0;
    for (let i = 0; i < 12; i++) { v[(r + i) % 12] = pat[i]; s2 += pat[i] * pat[i]; }
    const n = Math.sqrt(s2); for (let i = 0; i < 12; i++) v[i] /= n;
    templates[NOTE_NAMES[r] + q] = v;
  }
}

function matchChord(chroma, rootOnly) {
  let best = '', bestSim = -1;
  for (const [name, tmpl] of Object.entries(templates)) {
    if (rootOnly && name.slice(0, -3) !== rootOnly) continue;
    let dot = 0; for (let i = 0; i < 12; i++) dot += chroma[i] * tmpl[i];
    if (dot > bestSim) { bestSim = dot; best = name; }
  }
  return { name: best, sim: bestSim };
}

// === MIDI GT（仅 T5 段） ===
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
  if (gtActive[w].size > 0) gtChords[w] = matchChord(midiChroma([...gtActive[w]])).name;
  else gtChords[w] = 'N';
}

// === WAV 读取（仅 T5） ===
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

console.log(`T5 段 (${T5_START}-${T5_START+T5_DUR}s): ${durSamples} 样点`);

// === 两种色度方法对比 ===
const tf = Math.floor((durSamples - FFT_SIZE) / HOP) + 1;
const hopSec = HOP / SR;

// 方法1: 全频段色度
const chromas1 = []; for (let fi = 0; fi < tf; fi++) chromas1.push(getFullChroma(mono.slice(fi * HOP, fi * HOP + FFT_SIZE)));
const raw1 = chromas1.map(c => matchChord(c).name);

// 方法2: 低频色度 (40-440Hz)
const chromas2 = []; for (let fi = 0; fi < tf; fi++) chromas2.push(getBassChroma(mono.slice(fi * HOP, fi * HOP + FFT_SIZE)));
const bassPc = chromas2.map(c => { let best = 0; for (let i = 1; i < 12; i++) if (c[i] > c[best]) best = i; return NOTE_NAMES[best]; });
const raw2 = chromas1.map((c, i) => matchChord(c, bassPc[i]).name);

// === 评估 ===
function evalMethod(name, det) {
  let corr = 0, total = 0;
  for (let w = 0; w < gtWindows; w++) {
    if (gtChords[w] === 'N') continue;
    total++;
    const fi = Math.round(w * WINDOW / hopSec);
    const d = fi < det.length ? det[fi] : 'N';
    if (d === gtChords[w]) corr++;
  }
  const acc = (corr / total * 100) || 0;
  console.log(`\n${name}`);
  console.log(`  GT和弦: ${gtChords.filter(c => c !== 'N').join(' → ')}`);
  const detSummary = gtChords.map((g, w) => {
    const fi = Math.round(w * WINDOW / hopSec);
    return fi < det.length ? det[fi] : 'N';
  });
  console.log(`  检测: ${detSummary.filter((d, i) => gtChords[i] !== 'N').join(' → ')}`);
  console.log(`  准确率: ${corr}/${total} = ${acc.toFixed(1)}%`);
}

evalMethod('方法1: 全频段色度', raw1);
evalMethod('方法2: 低频根音约束', raw2);
