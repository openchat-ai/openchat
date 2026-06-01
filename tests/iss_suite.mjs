// ISS 系列对比实验
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 4096, HALF = FFT_SIZE >> 1;
const T5_START = 200, T5_DUR = 10, WINDOW = 0.5;
const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
function f2m(f) { return 12 * Math.log2(f / 440) + 69; }
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } }
}

// === 全局工具 ===
const NOTE = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHORD_INTS = { '':[0,4,7], 'm':[0,3,7], 'dim':[0,3,6], 'aug':[0,4,8], 'sus2':[0,2,7], 'sus4':[0,5,7], '7':[0,4,7,10], 'm7':[0,3,7,10], 'maj7':[0,4,7,11], 'dim7':[0,3,6,9], 'm7b5':[0,3,6,10], 'aug7':[0,4,8,10] };
const allTemplates = {};
for (const [sfx, ints] of Object.entries(CHORD_INTS)) for (let r = 0; r < 12; r++) { const shifted = ints.map(d => (r + d) % 12); allTemplates[NOTE[r] + sfx] = shifted; }
function rootOf(n) { return n.replace(/maj|m|dim|aug|sus\d|7|b5/g,'').trim(); }

// 读取 WAV
const buf = fs.readFileSync('jzlg.wav'); let off = 12, dataOff;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const ss = Math.round(T5_START * SR), ds = Math.round(T5_DUR * SR);
const mono = new Float64Array(ds);
for (let i = 0; i < ds; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }

// 等响度加权
const eqWeight = new Float64Array(HALF);
const eqPts = [[20,-50],[31.5,-39],[63,-26],[100,-19],[200,-11],[500,-3],[1000,0],[2000,1.5],[3150,0.5],[5000,-2],[6300,-4],[8000,-6],[10000,-10],[12500,-15]];
for (let i = 0; i < HALF; i++) { const f = i * SR / FFT_SIZE; let g = -100; for (let pi = 0; pi < eqPts.length - 1; pi++) if (f >= eqPts[pi][0] && f <= eqPts[pi+1][0]) { const t = (f - eqPts[pi][0]) / (eqPts[pi+1][0] - eqPts[pi][0]); g = eqPts[pi][1] + t * (eqPts[pi+1][1] - eqPts[pi][1]); } eqWeight[i] = Math.pow(10, g / 20); }

// 构建频谱
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

// HPSS
function hpss(spec) {
  const frames = spec.length, bins = spec[0].length, harm = spec.map(r => new Float64Array(r)), tWin = 7, halfT = Math.floor(tWin / 2);
  for (let b = 0; b < bins; b++) for (let f = 0; f < frames; f++) {
    const vals = []; for (let o = -halfT; o <= halfT; o++) { const fi = f + o; if (fi >= 0 && fi < frames) vals.push(spec[fi][b]); }
    vals.sort((a, b) => a - b); harm[f][b] = vals[Math.floor(vals.length / 2)];
  }
  return harm;
}
const specHarm = hpss(rawSpec);

// MIDI GT
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
function matchChordChroma(ch) {
  let best = '', bs = -1;
  for (const [name, ints] of Object.entries(allTemplates)) {
    const v = new Float64Array(12); for (const pc of ints) v[pc] = 1;
    let s = 0; for (let i = 0; i < 12; i++) s += v[i] * v[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
    let dot = 0; for (let i = 0; i < 12; i++) dot += ch[i] * v[i];
    if (dot > bs) { bs = dot; best = name; }
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

// === ISS 核心：可调参数 ===
function subtractMode(mag, freq, sr, mode) {
  const r = new Float64Array(mag);
  for (let h = 1; h <= 10; h++) {
    const hf = freq * h; if (hf > sr / 2) break;
    const hb = Math.round(hf * FFT_SIZE / sr);
    for (let d = -3; d <= 3; d++) {
      const b = hb + d; if (b < 0 || b >= HALF) continue;
      if (mode === 'zero') r[b] = 0;
      else if (mode === 'scale') r[b] *= 0.1;
    }
  }
  return r;
}

function runISS(specBank, opts) {
  const winFrames = Math.round(WINDOW * SR / HOP);
  const HP = Math.round(200 * FFT_SIZE / SR);
  const results = { correct: 0, rootMatch: 0, total: 0, dets: [] };

  for (let w = 0; w < gtWindows; w++) {
    if (gtChords[w] === 'N') { results.dets.push('N'); continue; }
    results.total++;

    // 累积谱
    const accum = new Float64Array(HALF); let fc = 0;
    for (let o = 0; o < winFrames && w * winFrames + o < tf; o++) {
      const m = specBank[w * winFrames + o];
      for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++;
    }
    if (fc) for (let i = 0; i < HALF; i++) accum[i] /= fc;

    // 高通透吉他
    const gMag = new Float64Array(HALF);
    for (let i = HP; i < HALF; i++) gMag[i] = opts.noHP ? accum[i] : (i >= HP ? accum[i] : 0);

    // ISS 迭代提取
    const minB = Math.round(HALF * 40 / SR), maxB = Math.round(HALF * 1500 / SR);
    const ww = [0, 1, 0.7, 0.5, 0.3, 0.2];
    const pitches = [];
    let cur = opts.noHP ? new Float64Array(accum) : new Float64Array(gMag);

    for (let iter = 0; iter < (opts.maxPitches || 8); iter++) {
      const hs = new Float64Array(HALF);
      for (let i = minB; i < maxB; i++) { let s = 0; for (let h = 1; h <= 5; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += cur[idx] * ww[h]; } hs[i] = s; }
      let bi = minB, bv = 0;
      for (let i = minB + 1; i < maxB - 1; i++) { if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > bv) { bv = hs[i]; bi = i; } }
      if (bv < 1e-6) break;
      const f = bi * SR / FFT_SIZE; if (f < 40 || f > 1500) break;
      const conf = bv / (cur.reduce((s, v) => s + v, 0) / HALF + 1e-10);
      if (conf < 0.5) break;
      const midi = f2m(f), pc = ((Math.round(midi) % 12) + 12) % 12;
      const isH = pitches.some(p => p.conf >= conf && Math.abs(f / p.freq - Math.round(f / p.freq)) < 0.08 && Math.round(f / p.freq) >= 2);
      const dup = pitches.some(p => Math.abs(f2m(p.freq) - midi) < 3);
      if (!dup && !isH) pitches.push({ freq: f, midi, pc, conf });
      cur = subtractMode(cur, f, SR, opts.subMode || 'zero');
    }

    // 构建 chroma
    const chroma = new Float64Array(12);
    if (opts.binaryChroma) {
      for (const p of pitches) chroma[p.pc] = 1;
    } else {
      for (const p of pitches) chroma[p.pc] += p.conf;
    }
    let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;

    // 贝斯约束
    let det = matchChordChroma(chroma);
    if (opts.bassConstraint && opts.bassConstraint !== 'none') {
      const bMag = new Float64Array(HALF);
      for (let i = 1; i < HP; i++) bMag[i] = accum[i];
      const bMinB = Math.round(HALF * 40 / SR), bMaxB = Math.round(HALF * 200 / SR);
      let bCur = new Float64Array(bMag);
      const bPitches = [];
      for (let iter = 0; iter < 4; iter++) {
        const hs = new Float64Array(HALF);
        for (let i = bMinB; i < bMaxB; i++) { let s = 0; for (let h = 1; h <= 3; h++) { const idx = Math.round(i * h); if (idx >= HALF) break; s += bCur[idx] * [0, 1, 0.5, 0.3][h]; } hs[i] = s; }
        let bi = bMinB, bv = 0;
        for (let i = bMinB + 1; i < bMaxB - 1; i++) { if (hs[i] > hs[i - 1] && hs[i] > hs[i + 1] && hs[i] > bv) { bv = hs[i]; bi = i; } }
        if (bv < 1e-6) break;
        const f = bi * SR / FFT_SIZE; if (f < 40 || f > 200) break;
        bPitches.push({ freq: f, pc: ((Math.round(f2m(f)) % 12) + 12) % 12, conf: bv / (bCur.reduce((s, v) => s + v, 0) / HALF + 1e-10) });
        bCur = subtractMode(bCur, f, SR, 'zero');
      }
      if (bPitches.length) {
        const bassPC = bPitches.sort((a, b) => a.freq - b.freq)[0].pc; // 最低音 = bass root
        // 如果检测和旋根音与贝斯不同，尝试强制贝斯根音
        const detRootPC = NOTE.indexOf(rootOf(det));
        if (detRootPC !== bassPC) {
          let best = '', bestSim = -1;
          for (const [name, ints] of Object.entries(allTemplates)) {
            if (NOTE.indexOf(rootOf(name)) !== bassPC) continue;
            const v = new Float64Array(12); for (const pc of ints) v[pc] = 1;
            let s = 0; for (let i = 0; i < 12; i++) s += v[i] * v[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) v[i] /= n;
            let dot = 0; for (let i = 0; i < 12; i++) dot += chroma[i] * v[i];
            if (dot > bestSim) { bestSim = dot; best = name; }
          }
          if (best) {
            // 对比原检测和受约束的相似度，只取更好的
            const origDot = (() => { const v = new Float64Array(12); for (const pc of allTemplates[det]) v[pc] = 1; let s=0; for(let i=0;i<12;i++) s+=v[i]*v[i]; const n=Math.sqrt(s)||1; for(let i=0;i<12;i++)v[i]/=n; let dot=0; for(let i=0;i<12;i++) dot+=chroma[i]*v[i]; return dot; })();
            const newDot = (() => { const v = new Float64Array(12); for (const pc of allTemplates[best]) v[pc] = 1; let s=0; for(let i=0;i<12;i++) s+=v[i]*v[i]; const n=Math.sqrt(s)||1; for(let i=0;i<12;i++)v[i]/=n; let dot=0; for(let i=0;i<12;i++) dot+=chroma[i]*v[i]; return dot; })();
            // 只在贝斯约束的匹配不太差时采用
            if (opts.bassConstraint === 'strict' || newDot > origDot * 0.7) det = best;
          }
        }
      }
    }

    results.dets.push(det);
    if (det === gtChords[w]) results.correct++;
    if (rootOf(det) === rootOf(gtChords[w])) results.rootMatch++;
  }
  return results;
}

// === 实验矩阵 ===
const experiments = [
  // [名称, 配置]
  ['基线 (v8 分频段 HPSS)', { subMode: 'zero', noHP: false, bassConstraint: 'none', binaryChroma: false, maxPitches: 8 }],
  ['A: 衰减式减法', { subMode: 'scale', noHP: false, bassConstraint: 'none', binaryChroma: false, maxPitches: 8 }],
  ['B: 无 HPSS', { subMode: 'zero', noHP: true, bassConstraint: 'none', binaryChroma: false, maxPitches: 8 }],
  ['C: 无色度加权', { subMode: 'zero', noHP: false, bassConstraint: 'none', binaryChroma: true, maxPitches: 8 }],
  ['D: 贝斯弱约束', { subMode: 'zero', noHP: false, bassConstraint: 'soft', binaryChroma: false, maxPitches: 8 }],
  ['E: 贝斯强约束', { subMode: 'zero', noHP: false, bassConstraint: 'strict', binaryChroma: false, maxPitches: 8 }],
  ['F: 少音迭代', { subMode: 'zero', noHP: false, bassConstraint: 'none', binaryChroma: false, maxPitches: 5 }],
  ['G: 衰减+贝斯弱约束', { subMode: 'scale', noHP: false, bassConstraint: 'soft', binaryChroma: false, maxPitches: 8 }],
];

console.log('ISS 系列对比实验 — T5 (200-210s)\n');
for (const [name, opts] of experiments) {
  const t0 = Date.now();
  const r = runISS(opts.noHP ? rawSpec : specHarm, opts);
  const t = Date.now() - t0;
  const acc = (r.correct / r.total * 100) || 0;
  const rootAcc = (r.rootMatch / r.total * 100) || 0;
  console.log(`${name.padEnd(16)}  ${acc.toFixed(1).padStart(5)}% (${r.correct}/${r.total})  根音:${rootAcc.toFixed(1).padStart(5)}%  ${t}ms`);
  if (name.startsWith('基线')) console.log(`  GT:  ${gtChords.filter(c=>c!=='N').join(' → ')}\n  检测: ${r.dets.filter(d=>d!=='N').join(' → ')}`);
}
