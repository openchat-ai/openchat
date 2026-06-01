// 和弦 v11：频谱直接匹配 — 144 个和弦的期望谱 vs 实际谱
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

const buf = fs.readFileSync('jzlg.wav'); let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

const eqWeight = new Float64Array(HALF);
const eqPts = [[20,-50],[31.5,-39],[63,-26],[100,-19],[200,-11],[500,-3],[1000,0],[2000,1.5],[3150,0.5],[5000,-2],[6300,-4],[8000,-6],[10000,-10],[12500,-15]];
for (let i = 0; i < HALF; i++) { const f = i * SR / FFT_SIZE; let g = -100; for (let pi = 0; pi < eqPts.length - 1; pi++) if (f >= eqPts[pi][0] && f <= eqPts[pi+1][0]) { const t = (f - eqPts[pi][0]) / (eqPts[pi+1][0] - eqPts[pi][0]); g = eqPts[pi][1] + t * (eqPts[pi+1][1] - eqPts[pi][1]); } eqWeight[i] = Math.pow(10, g / 20); }

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

const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const spb = te.microsecondsPerBeat / 1000000, ppq = midi.header.ticksPerBeat;
const gtWindows = Math.ceil(T5_DUR / WINDOW);
const gtActive = new Array(gtWindows); for (let i = 0; i < gtWindows; i++) gtActive[i] = new Set();
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, ac = {};
  for (const e of track) {
    tick += e.deltaTime || 0; const sec = tick / ppq * spb; if (sec > T5_START + T5_DUR) break;
    if (e.type === 'noteOn' && e.velocity > 0) ac[e.noteNumber] = sec;
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) { if (ac[e.noteNumber]) { const si = Math.max(0, Math.floor((ac[e.noteNumber] - T5_START) / WINDOW)); const ei = Math.min(gtWindows, Math.ceil((sec - T5_START) / WINDOW)); for (let w = si; w < ei; w++) gtActive[w].add(e.noteNumber); delete ac[e.noteNumber]; } }
  }
}
function matchChordChroma(ch) {
  let best = '', bs = -1;
  for (const [name, ints] of Object.entries(CHORD_INTS)) for (let r = 0; r < 12; r++) {
    const shifted = ints.map(d => (r + d) % 12);
    const v = new Float64Array(12); for (const pc of shifted) v[pc] = 1;
    let s = 0; for (let i = 0; i < 12; i++) s += v[i] * v[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
    let dot = 0; for (let i = 0; i < 12; i++) dot += ch[i] * v[i];
    if (dot > bs) { bs = dot; best = NOTE[r] + name; }
  }
  return best;
}
const gtChords = new Array(gtWindows);
for (let w = 0; w < gtWindows; w++) {
  if (!gtActive[w].size) { gtChords[w] = 'N'; continue; }
  const c = new Float64Array(12); for (const n of gtActive[w]) c[((n % 12) + 12) % 12] += 1;
  let s = 0; for (let i = 0; i < 12; i++) s += c[i] * c[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) c[i] /= n;
  gtChords[w] = matchChordChroma(c);
}

// === 生成和弦期望频谱 ===
// 每个音高(freq)生成泛音列：f, 2f, 3f, ... 10f, 幅值 = 1/h
function noteSpectrum(freq, sr) {
  const mag = new Float64Array(HALF);
  for (let h = 1; h <= 10; h++) {
    const hf = freq * h; if (hf > sr / 2) break;
    const bin = Math.round(hf * FFT_SIZE / sr);
    if (bin > 0 && bin < HALF) mag[bin] += 1 / h;
  }
  return mag;
}

// 预计算所有和弦（144）的期望频谱（归一化）
const chordSpectra = {};
const HP_BIN = Math.round(200 * FFT_SIZE / SR);
for (const [sfx, ints] of Object.entries(CHORD_INTS)) {
  for (let r = 0; r < 12; r++) {
    const name = NOTE[r] + sfx;
    const mag = new Float64Array(HALF);
    for (const d of ints) {
      // 根音在三音和五音之间的频段
      const midi = 40 + d; // 假想 midi 音高
      const freq = 440 * Math.pow(2, (midi - 69) / 12) * Math.pow(2, r); // 不对
      // 正确：根音频率 = 440 * 2^((NOTE[r] - 69) / 12)
      // NOTE[r] 对应 MIDI 编号：C4=60, C#4=61... 但这里只有 pitch class，没有八度
      // 实际上我们不知道八度，需要在多个八度生成
    }
    // 简化：在 4 个八度内生成（MIDI 48-96）
    for (const d of ints) {
      const pc = (r + d) % 12;
      // 音高范围 82-1047Hz（MIDI 36-84）
      for (let oct = 3; oct <= 6; oct++) {
        const midiNum = pc + oct * 12;
        if (midiNum < 28 || midiNum > 96) continue;
        const freq = 440 * Math.pow(2, (midiNum - 69) / 12);
        const ns = noteSpectrum(freq, SR);
        for (let i = HP_BIN; i < HALF; i++) mag[i] += ns[i];
      }
    }
    // 归一化
    let s = 0; for (let i = HP_BIN; i < HALF; i++) s += mag[i] * mag[i];
    const n = Math.sqrt(s) || 1; for (let i = HP_BIN; i < HALF; i++) mag[i] /= n;
    chordSpectra[name] = mag;
  }
}

// === 色度 + 频谱融合 ===
function matchFused(actual, hpBin, wSpec = 0.4) {
  // 归一化实际谱
  const aMag = new Float64Array(actual);
  let s = 0; for (let i = hpBin; i < HALF; i++) s += aMag[i] * aMag[i];
  const n = Math.sqrt(s) || 1; for (let i = hpBin; i < HALF; i++) aMag[i] /= n;

  // 构建色度
  const chroma = new Float64Array(12);
  for (let i = hpBin; i < HALF; i++) {
    const freq = i * SR / FFT_SIZE;
    const pc = ((Math.round(12 * Math.log2(freq / 440) + 69) % 12) + 12) % 12;
    chroma[pc] += aMag[i];
  }
  s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
  const cn = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= cn;

  // 色度模板
  const chromaTemplates = {};
  for (const [sfx, ints] of Object.entries(CHORD_INTS)) for (let r = 0; r < 12; r++) {
    const shifted = ints.map(d => (r + d) % 12);
    const v = new Float64Array(12); for (const pc of shifted) v[pc] = 1;
    let ss = 0; for (let i = 0; i < 12; i++) ss += v[i] * v[i]; const nn = Math.sqrt(ss) || 1; for (let i = 0; i < 12; i++) v[i] /= nn;
    chromaTemplates[NOTE[r] + sfx] = v;
  }

  let best = '', bestFused = -Infinity;
  for (const [name, expected] of Object.entries(chordSpectra)) {
    // 频谱相似度
    let dotSpectrum = 0;
    for (let i = hpBin; i < HALF; i++) dotSpectrum += aMag[i] * expected[i];

    // 色度相似度
    const tmpl = chromaTemplates[name];
    let dotChroma = 0; for (let i = 0; i < 12; i++) dotChroma += chroma[i] * tmpl[i];

    const fused = dotSpectrum * wSpec + dotChroma * (1 - wSpec);
    if (fused > bestFused) { bestFused = fused; best = name; }
  }
  return best;
}

const winFrames = Math.round(WINDOW * SR / HOP);
console.log('和弦 v12：频谱+色度融合\n');

let correct = 0, rootMatch = 0, total = 0; const dets = [];
const t0 = Date.now();
for (let w = 0; w < gtWindows; w++) {
  if (gtChords[w] === 'N') { dets.push('N'); continue; } total++;
  const accum = new Float64Array(HALF); let fc = 0;
  for (let o = 0; o < winFrames && w * winFrames + o < tf; o++) { const m = specHarm[w * winFrames + o]; for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++; }
  if (fc) for (let i = 0; i < HALF; i++) accum[i] /= fc;
  const det = matchFused(accum, 0);
  dets.push(det);
  if (det === gtChords[w]) correct++;
  if (rootOf(det) === rootOf(gtChords[w])) rootMatch++;
}
const acc = (correct/total*100)||0, rootAcc = (rootMatch/total*100)||0;
const t = Date.now() - t0;
console.log(`融合 (0.4频谱+0.6色度): ${acc.toFixed(1)}% (${correct}/${total}), 根音: ${rootAcc.toFixed(1)}%  ${t}ms`);
console.log(`  GT:  ${gtChords.filter(c=>c!=='N').join(' → ')}`);
console.log(`  检测: ${dets.filter(d=>d!=='N').join(' → ')}`);

// 尝试不同权重
for (const ws of [0.2, 0.3, 0.5, 0.6, 0.7]) {
  let c=0, rm=0, tot=0;
  for (let w = 0; w < gtWindows; w++) {
    if (gtChords[w] === 'N') continue; tot++;
    const accum = new Float64Array(HALF); let fc = 0;
    for (let o = 0; o < winFrames && w * winFrames + o < tf; o++) { const m = specHarm[w * winFrames + o]; for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++; }
    if (fc) for (let i = 0; i < HALF; i++) accum[i] /= fc;
    const det = matchFused(accum, 0, ws);
    if (det === gtChords[w]) c++;
    if (rootOf(det) === rootOf(gtChords[w])) rm++;
  }
  console.log(`  wSpec=${ws.toFixed(1)}: ${(c/tot*100||0).toFixed(1)}% 根音=${(rm/tot*100||0).toFixed(1)}%`);
}
