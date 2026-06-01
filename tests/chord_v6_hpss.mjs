// 和弦 v6：复现 v3 的 HPSS 谱 + 根音匹配率
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

const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHORD_TYPES = {
  '': [0,4,7], 'm': [0,3,7], 'dim': [0,3,6], 'aug': [0,4,8],
  'sus2': [0,2,7], 'sus4': [0,5,7],
  '7': [0,4,7,10], 'm7': [0,3,7,10], 'maj7': [0,4,7,11], 'dim7': [0,3,6,9], 'm7b5': [0,3,6,10], 'aug7': [0,4,8,10],
};
function makeTmpl(patterns) {
  const out = {};
  for (const [suffix, ints] of patterns) {
    for (let r = 0; r < 12; r++) {
      const v = new Float64Array(12); let sum = 0;
      for (const d of ints) { const pc = (r + d) % 12; v[pc] = 1; }
      for (let i = 0; i < 12; i++) sum += v[i] * v[i];
      const n = Math.sqrt(sum) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
      out[NOTE[r] + suffix] = v;
    }
  }
  return out;
}
// 均等权重 [1,1,1]，与 v3 一致
const allTemplates = makeTmpl(Object.entries(CHORD_TYPES));
const majMinTemplates = makeTmpl([['maj', [0,4,7]], ['min', [0,3,7]]]);

function matchChord(chroma, templates) {
  let best = '', bestSim = -1;
  for (const [name, tmpl] of Object.entries(templates)) {
    let dot = 0; for (let i = 0; i < 12; i++) dot += chroma[i] * tmpl[i];
    if (dot > bestSim) { bestSim = dot; best = name; }
  }
  return best;
}
function rootOf(name) { return name ? name.replace(/[^\w]/g,'').replace(/maj|m|dim|aug|sus\d|7|b5/g,'') : ''; }

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
        const si = Math.max(0, Math.floor((ac[e.noteNumber] - T5_START) / WINDOW));
        const ei = Math.min(gtWindows, Math.ceil((sec - T5_START) / WINDOW));
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
const gtMajMin = new Array(gtWindows);
const gtFull = new Array(gtWindows);
for (let w = 0; w < gtWindows; w++) {
  if (gtActive[w].size > 0) {
    const ch = midiChroma([...gtActive[w]]);
    gtMajMin[w] = matchChord(ch, majMinTemplates);
    gtFull[w] = matchChord(ch, allTemplates);
  } else { gtMajMin[w] = 'N'; gtFull[w] = 'N'; }
}

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

// === 构建频谱 ===
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

const winFrames = Math.round(WINDOW * SR / HOP);
console.log(`和弦 v6：复现 v3 HPSS 谱 + 根音匹配`);
console.log(`总窗口: ${gtWindows}`);

// 测试不同模板集
const experiments = [
  { name: '24 模板(大/小) - 准确率', templates: majMinTemplates, gt: gtMajMin },
  { name: '144 模板(全) - 准确率', templates: allTemplates, gt: gtFull },
];

for (const exp of experiments) {
  const accumChroma = [];
  for (let fi = 0; fi < tf; fi += winFrames) {
    const chroma = new Float64Array(12);
    let count = 0;
    for (let o = 0; o < winFrames && fi + o < tf; o++) {
      const c = new Float64Array(12);
      const mag = specHarm[fi + o];
      for (let i = 1; i < HALF; i++) {
        const freq = i * SR / FFT_SIZE;
        const pc = ((Math.round(12 * Math.log2(freq / 440) + 69) % 12) + 12) % 12;
        c[pc] += mag[i];
      }
      for (let i = 0; i < 12; i++) chroma[i] += c[i];
      count++;
    }
    if (count) for (let i = 0; i < 12; i++) chroma[i] /= count;
    let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
    const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
    accumChroma.push(chroma);
  }

  let correct = 0, rootMatch = 0, total = 0;
  const detSeq = [];
  for (let w = 0; w < gtWindows; w++) {
    if (exp.gt[w] === 'N') continue;
    total++;
    const ai = Math.floor(w * WINDOW / WINDOW);
    const d = ai < accumChroma.length ? matchChord(accumChroma[ai], exp.templates) : 'N';
    detSeq.push(d);
    if (d === exp.gt[w]) correct++;
    if (rootOf(d) === rootOf(exp.gt[w])) rootMatch++;
  }
  const acc = (correct / total * 100) || 0;
  const rootAcc = (rootMatch / total * 100) || 0;
  console.log(`\n${exp.name}: ${acc.toFixed(1)}% (${correct}/${total})`);
  console.log(`    根音匹配: ${rootAcc.toFixed(1)}% (${rootMatch}/${total})`);
}

// 打印 GT 和检测
const gtSeq = gtFull.filter(c => c !== 'N');
const detSeq = [];
const acChroma = [];
for (let fi = 0; fi < tf; fi += winFrames) {
  const chroma = new Float64Array(12); let cnt = 0;
  for (let o = 0; o < winFrames && fi + o < tf; o++) {
    const c = new Float64Array(12);
    for (let i = 1; i < HALF; i++) {
      const pc = ((Math.round(12 * Math.log2(i * SR / FFT_SIZE / 440) + 69) % 12) + 12) % 12;
      c[pc] += specHarm[fi + o][i];
    }
    for (let i = 0; i < 12; i++) chroma[i] += c[i]; cnt++;
  }
  if (cnt) for (let i = 0; i < 12; i++) chroma[i] /= cnt;
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  acChroma.push(chroma);
}
for (let w = 0; w < gtWindows; w++) {
  if (gtFull[w] === 'N') continue;
  const d = w < acChroma.length ? matchChord(acChroma[w], allTemplates) : 'N';
  detSeq.push(d);
}
console.log(`\n  GT:  ${gtSeq.join(' → ')}`);
console.log(`  检测: ${detSeq.join(' → ')}`);
