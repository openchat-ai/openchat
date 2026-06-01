// 和弦 v5：用 V4 流水线检测出的音高列表建色度
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function computeMag(s) {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i]; fft(re, im, FFT_SIZE);
  const m = new Float64Array(HALF); for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); return m;
}

// === V4 核心检测（简化版，单通道，无跟踪）===
function detectNotes(signal, sr) {
  const tf = Math.floor((signal.length - FFT_SIZE) / HOP) + 1;
  const hs = new Float64Array(HALF), ww = [0, 1, 0.7, 0.5, 0.3, 0.2];

  function hps(mag) {
    const hps = new Float64Array(HALF);
    for (let i = 0; i < HALF; i++) { let s = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += mag[idx] * ww[h]; } hps[i] = s; }
    const minB = Math.round(HALF * 40 / sr), maxB = Math.round(HALF * 1500 / sr);
    let bestI = minB, bestV = 0;
    for (let i = minB + 1; i < maxB - 1; i++) {
      if (hps[i] > hps[i-1] && hps[i] > hps[i+1] && hps[i] > bestV) { bestV = hps[i]; bestI = i; }
    }
    if (bestV < 1e-10) return null;
    return { freq: bestI * sr / FFT_SIZE, bin: bestI };
  }

  const notes = [];
  for (let fi = 0; fi < tf; fi++) {
    const frame = signal.slice(fi * HOP, fi * HOP + FFT_SIZE);
    const mag = computeMag(frame);
    const r = hps(mag);
    if (r) notes.push({ time: fi * HOP / sr, freq: r.freq, midi: f2m(r.freq) });
  }
  return notes;
}

// === 12 类和弦模板（同 v4）===
const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHORD_TYPES = {
  '':      [0, 4, 7],
  'm':     [0, 3, 7],
  'dim':   [0, 3, 6],
  'aug':   [0, 4, 8],
  'sus2':  [0, 2, 7],
  'sus4':  [0, 5, 7],
  '7':     [0, 4, 7, 10],
  'm7':    [0, 3, 7, 10],
  'maj7':  [0, 4, 7, 11],
  'dim7':  [0, 3, 6, 9],
  'm7b5':  [0, 3, 6, 10],
  'aug7':  [0, 4, 8, 10],
};
const templates = {};
for (let r = 0; r < 12; r++) for (const [suffix, ints] of Object.entries(CHORD_TYPES)) {
  const v = new Float64Array(12); let sum = 0;
  for (let ri = 0; ri < ints.length; ri++) v[(r + ints[ri]) % 12] = [1.0, 0.7, 0.5, 0.4][ri] || 0.3;
  for (let i = 0; i < 12; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum) || 1; for (let i = 0; i < 12; i++) v[i] /= norm;
  templates[NOTE[r] + suffix] = v;
}
function matchChord(chroma) {
  let best = '', bestSim = -1;
  for (const [name, tmpl] of Object.entries(templates)) {
    let dot = 0; for (let i = 0; i < 12; i++) dot += chroma[i] * tmpl[i];
    if (dot > bestSim) { bestSim = dot; best = name; }
  }
  return best;
}

// === MIDI GT ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000;
const ppq = midi.header.ticksPerBeat;
const gtWindows = Math.ceil(T5_DUR / WINDOW);
const gtActive = new Array(gtWindows);
for (let i = 0; i < gtWindows; i++) gtActive[i] = new Set();
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, ac = {};
  for (const e of track) {
    tick += e.deltaTime || 0; const sec = tick / ppq * spb;
    if (sec > T5_START + T5_DUR) break;
    if (e.type === 'noteOn' && e.velocity > 0) ac[e.noteNumber] = sec;
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      if (ac[e.noteNumber]) {
        const st = ac[e.noteNumber], en = sec;
        const si = Math.max(0, Math.floor((st - T5_START) / WINDOW));
        const ei = Math.min(gtWindows, Math.ceil((en - T5_START) / WINDOW));
        for (let w = si; w < ei; w++) gtActive[w].add(e.noteNumber);
        delete ac[e.noteNumber];
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
const gtChords = new Array(gtWindows);
for (let w = 0; w < gtWindows; w++) {
  gtChords[w] = gtActive[w].size > 0 ? matchChord(midiChroma([...gtActive[w]])) : 'N';
}

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
const a = 1 - 2 * Math.PI * 200 / SR;
const hp = new Float64Array(mono.length); let y = 0;
for (let i = 1; i < mono.length; i++) { y = mono[i] - mono[i - 1] + a * y; hp[i] = y; }

console.log('和弦 v5：V4 音高列表色度');
console.log(`GT 和弦集 (${new Set(gtChords.filter(c=>c!=='N')).size}): ${[...new Set(gtChords.filter(c=>c!=='N'))].join(', ')}`);

const t0 = Date.now();
const detNotes = detectNotes(hp, SR);
const elapsed = Date.now() - t0;
console.log(`检测到 ${detNotes.length} 音 (${elapsed}ms)`);

// 按窗口聚合色度
const detChords = [];
for (let w = 0; w < gtWindows; w++) {
  const wStart = w * WINDOW, wEnd = (w + 1) * WINDOW;
  const chroma = new Float64Array(12);
  const winNotes = detNotes.filter(n => n.time >= wStart && n.time < wEnd);
  if (winNotes.length === 0) { detChords.push('N'); continue; }
  for (const n of winNotes) {
    const pc = ((Math.round(n.midi) % 12) + 12) % 12;
    chroma[pc]++;
  }
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
  const nrm = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= nrm;
  detChords.push(matchChord(chroma));
}

let correct = 0, total = 0;
const detSeq = [];
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') continue;
  total++;
  detSeq.push(detChords[w] || 'N');
  if (detChords[w] === gtChords[w]) correct++;
}
const acc = (correct / total * 100) || 0;
const gtSeq = gtChords.filter(c => c !== 'N');
console.log(`\n准确率: ${acc.toFixed(1)}% (${correct}/${total})`);
console.log(`  GT:  ${gtSeq.join(' → ')}`);
console.log(`  检测: ${detSeq.join(' → ')}`);

// 每个窗口的音高分布
console.log(`\n每窗口音高检测数:`);
for (let w = 0; w < gtWindows; w++) {
  const wStart = w * WINDOW, wEnd = (w + 1) * WINDOW;
  const wn = detNotes.filter(n => n.time >= wStart && n.time < wEnd);
  const pcs = [...new Set(wn.map(n => ((Math.round(n.midi) % 12) + 12) % 12))].sort((a, b) => a - b).map(pc => NOTE[pc]);
  console.log(`  ${w}: ${wn.length}音 [${pcs.join(',')}]  GT=${gtChords[w]}  Det=${detChords[w]}`);
}
