// 和弦识别 v4：谐波累积色度 + 12 类和弦模板
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}

const eqWeight = new Float64Array(HALF);
const eqPts = [[20,-50],[31.5,-39],[63,-26],[100,-19],[200,-11],[500,-3],[1000,0],[2000,1.5],[3150,0.5],[5000,-2],[6300,-4],[8000,-6],[10000,-10],[12500,-15]];
for (let i = 0; i < HALF; i++) {
  const f = i * SR / FFT_SIZE; let g = -100;
  for (let pi = 0; pi < eqPts.length - 1; pi++) if (f >= eqPts[pi][0] && f <= eqPts[pi+1][0]) { const t = (f - eqPts[pi][0]) / (eqPts[pi+1][0] - eqPts[pi][0]); g = eqPts[pi][1] + t * (eqPts[pi+1][1] - eqPts[pi][1]); }
  eqWeight[i] = Math.pow(10, g / 20);
}

function hpss(spec) {
  const frames = spec.length, bins = spec[0].length;
  const harm = spec.map(r => new Float64Array(r));
  const tWin = 7, halfT = Math.floor(tWin / 2);
  for (let b = 0; b < bins; b++) for (let f = 0; f < frames; f++) {
    const vals = [];
    for (let o = -halfT; o <= halfT; o++) { const fi = f + o; if (fi >= 0 && fi < frames) vals.push(spec[fi][b]); }
    vals.sort((a, b) => a - b); harm[f][b] = vals[Math.floor(vals.length / 2)];
  }
  return harm;
}

// === 谐波累积色度：每 bin 贡献到自身及其泛音的 pitch class ===
function harmonicChroma(mag, binStart, binEnd) {
  const chroma = new Float64Array(12);
  for (let bi = binStart; bi < Math.min(binEnd, HALF); bi++) {
    const f0 = bi * SR / FFT_SIZE;
    if (f0 < 40 || f0 > 4000) continue;
    const val = mag[bi];
    // 自身贡献到基频的 pitch class
    const midi0 = 12 * Math.log2(f0 / 440) + 69;
    const pc0 = ((Math.round(midi0) % 12) + 12) % 12;
    chroma[pc0] += val * 1.0;
    // 作为 2-4 次谐波贡献到低八度的 pitch class
    for (let h = 2; h <= 4; h++) {
      const fSub = f0 / h;
      if (fSub < 40) break;
      const midiSub = 12 * Math.log2(fSub / 440) + 69;
      const pcSub = ((Math.round(midiSub) % 12) + 12) % 12;
      chroma[pcSub] += val * (0.6 / h);
    }
  }
  return chroma;
}

// === 12 类和弦模板（含七和弦） ===
const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
// 模板定义：每类模板是 [半音阶偏移数组]
const CHORD_TYPES = {
  '':      [0, 4, 7],          // major
  'm':     [0, 3, 7],          // minor
  'dim':   [0, 3, 6],          // diminished
  'aug':   [0, 4, 8],          // augmented
  'sus2':  [0, 2, 7],          // sus2
  'sus4':  [0, 5, 7],          // sus4
  '7':     [0, 4, 7, 10],      // dominant 7th
  'm7':    [0, 3, 7, 10],      // minor 7th
  'maj7':  [0, 4, 7, 11],      // major 7th
  'dim7':  [0, 3, 6, 9],       // diminished 7th
  'm7b5':  [0, 3, 6, 10],      // half-dim 7th
  'aug7':  [0, 4, 8, 10],      // augmented 7th
};

// 根音倍率（根音得 1.0，三音 0.7，五音 0.5，七音 0.4）
const ROLE_WEIGHT = { 0: 1.0, 1: 0.7, 2: 0.5, 3: 0.4 };

const templates = {};
for (let r = 0; r < 12; r++) {
  for (const [suffix, ints] of Object.entries(CHORD_TYPES)) {
    const v = new Float64Array(12); let sum = 0;
    for (let ri = 0; ri < ints.length; ri++) {
      const pc = (r + ints[ri]) % 12;
      const w = ROLE_WEIGHT[ri] || 0.3;
      v[pc] = Math.max(v[pc], w);
    }
    for (let i = 0; i < 12; i++) sum += v[i] * v[i];
    const norm = Math.sqrt(sum) || 1;
    for (let i = 0; i < 12; i++) v[i] /= norm;
    templates[NOTE[r] + suffix] = v;
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
// 打印 GT 唯一和弦
const gtSet = [...new Set(gtChords.filter(c => c !== 'N'))];
console.log(`GT 和弦集 (${gtSet.length}): ${gtSet.join(', ')}`);

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

console.log('和弦 v4：谐波累积色度 + 12 类模板');
console.log(`GT 窗口: ${gtWindows}（${WINDOW}s/窗口）`);

const tf = Math.floor((ds - FFT_SIZE) / HOP) + 1;
const spec = [];
for (let fi = 0; fi < tf; fi++) {
  const frame = mono.slice(fi * HOP, fi * HOP + FFT_SIZE);
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < frame.length; i++) re[i] = frame[i] * win[i];
  fft(re, im, FFT_SIZE);
  const mag = new Float64Array(HALF);
  for (let i = 0; i < HALF; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * eqWeight[i];
  spec.push(mag);
}
const specHarm = hpss(spec);

// 频谱白化：每 bin 除以其附近 ~200Hz 窗口的均值
function whiten(mag) {
  const w = new Float64Array(mag);
  const halfSpan = Math.round(200 / (SR / FFT_SIZE)); // ~17 bins
  for (let i = 0; i < HALF; i++) {
    let sum = 0, cnt = 0;
    for (let d = -halfSpan; d <= halfSpan; d++) { const idx = i + d; if (idx >= 0 && idx < HALF) { sum += mag[idx]; cnt++; } }
    const avg = sum / cnt || 1;
    w[i] = mag[i] / (avg + 1e-10);
  }
  return w;
}

const MODES = [
  { name: '普通色度 (v3基线)', fn: (mag, a, b) => { const w = whiten(mag); const c = new Float64Array(12); for (let i = a; i < Math.min(b, HALF); i++) { const f = i * SR / FFT_SIZE; const pc = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12; c[pc] += w[i]; } return c; } },
  { name: '白化+谐波累积', fn: (mag, a, b) => harmonicChroma(whiten(mag), a, b) },
];
const WIN_SIZES = [0.5];

for (const mode of MODES) {
  for (const winSec of WIN_SIZES) {
    const winFrames = Math.round(winSec * SR / HOP);
    const accumChroma = [];
    for (let fi = 0; fi < tf; fi += winFrames) {
      const chroma = new Float64Array(12);
      let count = 0;
      for (let o = 0; o < winFrames && fi + o < tf; o++) {
        const c = mode.fn(specHarm[fi + o], 1, HALF);
        for (let i = 0; i < 12; i++) chroma[i] += c[i];
        count++;
      }
      for (let i = 0; i < 12; i++) chroma[i] /= count;
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
    console.log(`\n${mode.name} ${winSec}s: ${acc.toFixed(1)}% (${correct}/${total})`);
    console.log(`  GT:  ${gtSeq.join(' → ')}`);
    console.log(`  检测: ${detSeq.join(' → ')}`);
  }
}
