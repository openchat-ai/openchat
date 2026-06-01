// 和弦 v8：分频段 ISS（吉他 HP 200Hz + 贝斯根音约束）
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
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
const CHORD_INTS = {
  '': [0,4,7], 'm': [0,3,7], 'dim': [0,3,6], 'aug': [0,4,8],
  'sus2': [0,2,7], 'sus4': [0,5,7],
  '7': [0,4,7,10], 'm7': [0,3,7,10], 'maj7': [0,4,7,11], 'dim7': [0,3,6,9], 'm7b5': [0,3,6,10], 'aug7': [0,4,8,10],
};
function makeTmpl(patterns) {
  const out = {};
  for (const [suffix, ints] of patterns) for (let r = 0; r < 12; r++) {
    const v = new Float64Array(12); let sum = 0;
    for (const d of ints) v[(r + d) % 12] = 1;
    for (let i = 0; i < 12; i++) sum += v[i] * v[i];
    const n = Math.sqrt(sum) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
    out[NOTE[r] + suffix] = v;
  }
  return out;
}
const allTemplates = makeTmpl(Object.entries(CHORD_INTS));
function matchChord(chroma, t) { let b='', bs=-1; for (const [n, v] of Object.entries(t)) { let d=0; for(let i=0;i<12;i++) d+=chroma[i]*v[i]; if(d>bs){bs=d;b=n;} } return b; }
function rootOf(n) { return n.replace(/maj|m|dim|aug|sus\d|7|b5/g,''); }
function pcOf(n) { return NOTE.indexOf(rootOf(n)); }

function subtractNote(mag, freq, sr) {
  const r = new Float64Array(mag);
  for (let h = 1; h <= 10; h++) { const hf = freq * h; if (hf > sr / 2) break; const hb = Math.round(hf * FFT_SIZE / sr); for (let d = -3; d <= 3; d++) { const b = hb + d; if (b >= 0 && b < HALF) r[b] = 0; } }
  return r;
}

// ISS 提取 + 谐波过滤
function pitchesFromSpectrum(mag, sr) {
  const minB = Math.round(HALF * 40 / sr), maxB = Math.round(HALF * 1500 / sr);
  const ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
  const pitches = []; let cur = new Float64Array(mag);
  for (let iter = 0; iter < 10; iter++) {
    const hs = new Float64Array(HALF);
    for (let i = minB; i < maxB; i++) { let s = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += cur[idx] * ww[h]; } hs[i] = s; }
    let bestI = minB, bestV = 0;
    for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i-1] && hs[i] > hs[i+1] && hs[i] > bestV) { bestV = hs[i]; bestI = i; } }
    if (bestV < 1e-6) break;
    const freq = bestI * sr / FFT_SIZE;
    if (freq < 40 || freq > 1500) break;
    const conf = bestV / (mag.reduce((s,v)=>s+v,0) / HALF + 1e-10);
    if (conf < 0.5) break;
    const midi = f2m(freq);
    const isH = pitches.some(p => p.conf >= conf && (freq / p.freq >= 1.9 && freq / p.freq <= 2.1 || freq / p.freq >= 2.9 && freq / p.freq <= 3.1));
    const dup = pitches.some(p => Math.abs(f2m(p.freq) - midi) < 3);
    if (!dup && !isH) pitches.push({ freq, midi, pc: ((Math.round(midi) % 12) + 12) % 12, conf });
    cur = subtractNote(cur, freq, sr);
  }
  return pitches;
}

// === 分频段滤波 ===
const HIGH_PASS_BIN = Math.round(200 * FFT_SIZE / SR); // HP 200Hz
const LOW_PASS_BIN = Math.round(200 * FFT_SIZE / SR);

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
  for (const e of track) { tick += e.deltaTime || 0; const sec = tick / ppq * spb; if (sec > T5_START + T5_DUR) break; if (e.type === 'noteOn' && e.velocity > 0) ac[e.noteNumber] = sec; if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) { if (ac[e.noteNumber]) { const si = Math.max(0, Math.floor((ac[e.noteNumber] - T5_START) / WINDOW)); const ei = Math.min(gtWindows, Math.ceil((sec - T5_START) / WINDOW)); for (let w = si; w < ei; w++) gtActive[w].add(e.noteNumber); delete ac[e.noteNumber]; } } }
}
function midiChroma(notes) { const c = new Float64Array(12); for (const n of notes) c[((n % 12) + 12) % 12] += 1; let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n; return c; }
const gtChords = new Array(gtWindows);
for (let w = 0; w < gtWindows; w++) gtChords[w] = gtActive[w].size > 0 ? matchChord(midiChroma([...gtActive[w]]), allTemplates) : 'N';

// === WAV ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

// === HPSS 频谱图 ===
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
const specHarm = hpss(rawSpec);

const winFrames = Math.round(WINDOW * SR / HOP);
console.log('和弦 v8：分频段 ISS + 贝斯根音约束');

for (const mode of ['仅吉他 (HP200)', '吉他+贝斯约束']) {
  const detChords = [];
  let correct = 0, rootMatch = 0, total = 0;
  for (let w = 0; w < gtWindows; w++) {
    if (gtChords[w] === 'N') { detChords.push('N'); continue; }
    total++;

    // 累积谱
    const accum = new Float64Array(HALF);
    let fc = 0;
    for (let o = 0; o < winFrames && w * winFrames + o < tf; o++) {
      const m = specHarm[w * winFrames + o];
      for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++;
    }
    if (fc) for (let i = 0; i < HALF; i++) accum[i] /= fc;

    // 吉他通道：只分析 > 200Hz
    const gAccum = new Float64Array(HALF);
    for (let i = HIGH_PASS_BIN; i < HALF; i++) gAccum[i] = accum[i];

    // 贝斯通道：分析 < 200Hz，提取最弱有意义音
    const bAccum = new Float64Array(HALF);
    for (let i = 1; i < LOW_PASS_BIN; i++) bAccum[i] = accum[i];

    // ISS 提取吉他音高
    const gPitches = pitchesFromSpectrum(gAccum, SR);
    const chroma = new Float64Array(12);
    for (const p of gPitches) chroma[p.pc] += p.conf;
    let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
    const nrm = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= nrm;

    let det = matchChord(chroma, allTemplates);

    // 贝斯根音约束
    if (mode === '吉他+贝斯约束') {
      const bPitches = pitchesFromSpectrum(bAccum, SR);
      // 贝斯根音：贝斯音高里最强音的 pitch class 或最低音的 pitch class
      let bassRoot = -1;
      if (bPitches.length) {
        bPitches.sort((a, b) => b.conf - a.conf);
        bassRoot = bPitches[0].pc;
        // 如果检测的和弦根音与贝斯冲突，选兼容贝斯的和弦
        if (pcOf(det) !== -1 && pcOf(det) !== bassRoot) {
          // 在模板中找根音 = bassRoot 且与 chroma 最匹配的
          let best = '', bestSim = -1;
          for (const [name, tmpl] of Object.entries(allTemplates)) {
            if (pcOf(name) !== bassRoot) continue;
            let d = 0; for (let i = 0; i < 12; i++) d += chroma[i] * tmpl[i];
            if (d > bestSim) { bestSim = d; best = name; }
          }
          if (best) det = best;
        }
      }
    }

    detChords.push(det);
    if (det === gtChords[w]) correct++;
    if (rootOf(det) === rootOf(gtChords[w])) rootMatch++;
  }
  const acc = (correct / total * 100) || 0;
  const rootAcc = (rootMatch / total * 100) || 0;
  console.log(`\n${mode}: ${acc.toFixed(1)}% (${correct}/${total}), 根音=${rootAcc.toFixed(1)}%`);
  console.log(`  GT:  ${gtChords.filter(c=>c!=='N').join(' → ')}`);
  console.log(`  检测: ${detChords.filter(d=>d!=='N').join(' → ')}`);
}
