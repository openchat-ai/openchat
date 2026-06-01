// chord_beat.mjs — 拍对齐窗和弦评估
import fs from 'fs';
import { parseMidi } from 'midi-file';

const SR = 48000, HOP = 1024, FFT_SIZE = 2048, HALF = FFT_SIZE >> 1;
const WINDOW = 0.5, NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = 88;

const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));
const eqWeight = new Float64Array(HALF);
const eqPts = [[20,-50],[31.5,-39],[63,-26],[100,-19],[200,-11],[500,-3],[1000,0],[2000,1.5],[3150,0.5],[5000,-2],[6300,-4],[8000,-6],[10000,-10],[12500,-15]];
for (let i = 0; i < HALF; i++) {
  const f = i * SR / FFT_SIZE; let g = -100;
  for (let pi = 0; pi < eqPts.length - 1; pi++) if (f >= eqPts[pi][0] && f <= eqPts[pi+1][0]) { const t = (f - eqPts[pi][0]) / (eqPts[pi+1][0] - eqPts[pi][0]); g = eqPts[pi][1] + t * (eqPts[pi+1][1] - eqPts[pi][1]); }
  eqWeight[i] = Math.pow(10, g / 20);
}
function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function hpss(spec) {
  const frames = spec.length, bins = spec[0].length, harm = spec.map(r => new Float64Array(r));
  const tWin = 7, halfT = Math.floor(tWin / 2);
  for (let b = 0; b < bins; b++) for (let f = 0; f < frames; f++) {
    const vals = []; for (let o = -halfT; o <= halfT; o++) { const fi = f + o; if (fi >= 0 && fi < frames) vals.push(spec[fi][b]); }
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
const TYPES = Object.keys(CHORD_INTS); const N_TYPES = 12;
const ALL_CHORDS = []; for (let r = 0; r < 12; r++) for (let ti = 0; ti < 12; ti++) ALL_CHORDS.push(NOTE[r] + TYPES[ti]);
const N_STATES = ALL_CHORDS.length;
function rootOf(name) { return name.replace(/maj|m|dim|aug|sus\d|7|b5/g,''); }
function buildTemplates() {
  const tmpl = new Array(N_STATES);
  for (let r = 0; r < 12; r++) for (let ti = 0; ti < 12; ti++) {
    const v = new Float64Array(12); let sum = 0;
    for (const d of CHORD_INTS[TYPES[ti]]) v[(r + d) % 12] = 1;
    for (let i = 0; i < 12; i++) sum += v[i] * v[i]; const n = Math.sqrt(sum) || 1;
    for (let i = 0; i < 12; i++) v[i] /= n;
    tmpl[r * 12 + ti] = v;
  }
  return tmpl;
}
const TEMPLATES = buildTemplates();
function matchChord(chroma) {
  let best = '', bs = -1;
  for (let si = 0; si < N_STATES; si++) { let d = 0; const t = TEMPLATES[si]; for (let i = 0; i < 12; i++) d += chroma[i] * t[i]; if (d > bs) { bs = d; best = ALL_CHORDS[si]; } }
  return best;
}

// === MIDI note list ===
const midi = parseMidi(fs.readFileSync('hotel-california.mid'));
const te = midi.tracks[0].find(e => e.type === 'setTempo');
const PPQ = midi.header.ticksPerBeat; // 480
const BPM = 75;
const spb = 60 / BPM; // 0.8
const tickPerSec = PPQ / spb; // 600

const allNotes = []; // { midi, startTick, endTick, track }
for (let ti = 1; ti < midi.tracks.length; ti++) {
  const track = midi.tracks[ti]; let tick = 0, ac = {};
  for (const e of track) {
    tick += e.deltaTime || 0;
    if (e.type === 'noteOn' && e.velocity > 0) ac[e.noteNumber] = tick;
    if (e.type === 'noteOff' || (e.type === 'noteOn' && e.velocity === 0)) {
      if (ac[e.noteNumber]) {
        allNotes.push({ midi: e.noteNumber, startTick: ac[e.noteNumber], endTick: tick, track: ti });
        delete ac[e.noteNumber];
      }
    }
  }
}

function getGtChords(startTime, dur, guitarOnly, windowTicks) {
  const startTick = Math.round(startTime * tickPerSec);
  const endTick = Math.round((startTime + dur) * tickPerSec);
  const adjStart = Math.floor(startTick / windowTicks) * windowTicks;
  const nWin = Math.ceil((endTick - adjStart) / windowTicks);
  const gtC = new Array(nWin);
  for (let w = 0; w < nWin; w++) {
    const ws = adjStart + w * windowTicks;
    const we = ws + windowTicks;
    const active = allNotes.filter(n => (trackFilter ? trackFilter(n) : true) && n.startTick < we && n.endTick > ws);
    if (active.length === 0) { gtC[w] = 'N'; continue; }
    const chroma = new Float64Array(12);
    for (const n of active) chroma[n.midi % 12] += 1;
    let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
    const norm = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= norm;
    gtC[w] = matchChord(chroma);
  }
  return { gtC, adjStart, nWin };
}

function getGtChordsFiltered(startTime, dur, trackFilter, windowTicks) {
  const startTick = Math.round(startTime * tickPerSec);
  const endTick = Math.round((startTime + dur) * tickPerSec);
  const adjStart = Math.floor(startTick / windowTicks) * windowTicks;
  const nWin = Math.ceil((endTick - adjStart) / windowTicks);
  const gtC = new Array(nWin);
  for (let w = 0; w < nWin; w++) {
    const ws = adjStart + w * windowTicks;
    const we = ws + windowTicks;
    const active = allNotes.filter(n => trackFilter(n) && n.startTick < we && n.endTick > ws);
    if (active.length === 0) { gtC[w] = 'N'; continue; }
    const chroma = new Float64Array(12);
    for (const n of active) chroma[n.midi % 12] += 1;
    let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i];
    const norm = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= norm;
    gtC[w] = matchChord(chroma);
  }
  return { gtC, adjStart, nWin };
}

// === NNLS ===
function buildDict(harmDecay, harmCap) {
  const dict = new Array(HALF); for (let b = 0; b < HALF; b++) dict[b] = new Float64Array(NOTE_COUNT);
  for (let ni = 0; ni < NOTE_COUNT; ni++) {
    const freq = 440 * Math.pow(2, (NOTE_MIN + ni - 69) / 12);
    for (let h = 1; h <= harmCap; h++) {
      const hf = freq * h; if (hf > SR / 2) break;
      const bin = Math.round(hf * FFT_SIZE / SR);
      if (bin >= 0 && bin < HALF) dict[bin][ni] += Math.pow(h, -harmDecay);
    }
  }
  for (let ni = 0; ni < NOTE_COUNT; ni++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][ni] * dict[b][ni]; const n = Math.sqrt(s) || 1; for (let b = 0; b < HALF; b++) dict[b][ni] /= n; }
  return dict;
}
function precomputeH(dict) {
  const H = new Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) { H[i] = new Float64Array(NOTE_COUNT); for (let j = 0; j < NOTE_COUNT; j++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * dict[b][j]; H[i][j] = s; } }
  return H;
}
function solveFISTA(H, g, maxIter) {
  const n = g.length; let x = new Float64Array(n), y = new Float64Array(n), tk = 1;
  let L = 1; const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = Math.random() * 2 - 1;
  for (let p = 0; p < 10; p++) { const w = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * v[j]; w[i] = s; } let nw=0,nv=0; for(let i=0;i<n;i++){nw+=w[i]*w[i];nv+=v[i]*v[i];} L=Math.sqrt(nw/nv); for(let i=0;i<n;i++) v[i]=w[i]/Math.sqrt(nw); }
  L = 2 * L; const invL = 1 / L;
  for (let iter = 0; iter < maxIter; iter++) {
    const Hy = new Float64Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += H[i][j] * y[j]; Hy[i] = s; }
    let change = 0; const xNew = new Float64Array(n);
    for (let i = 0; i < n; i++) { const grad = 2 * (Hy[i] - g[i]); xNew[i] = Math.max(0, y[i] - invL * grad); change += Math.abs(xNew[i] - x[i]); }
    if (change < 1e-8 * n) break;
    const tk1 = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2; const beta = (tk - 1) / tk1;
    for (let i = 0; i < n; i++) y[i] = xNew[i] + beta * (xNew[i] - x[i]); x = xNew; tk = tk1;
  }
  return x;
}
function nnlsChroma(dict, H, accum, maxIter, sharpen) {
  const g = new Float64Array(NOTE_COUNT);
  for (let i = 0; i < NOTE_COUNT; i++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * accum[b]; g[i] = s; }
  const acts = solveFISTA(H, g, maxIter);
  const chroma = new Float64Array(12);
  for (let ni = 0; ni < NOTE_COUNT; ni++) chroma[((NOTE_MIN + ni) % 12 + 12) % 12] += acts[ni];
  if (sharpen !== 1) for (let i = 0; i < 12; i++) chroma[i] = Math.pow(chroma[i], sharpen);
  let s = 0; for (let i = 0; i < 12; i++) s += chroma[i] * chroma[i]; const n = Math.sqrt(s) || 1; for (let i = 0; i < 12; i++) chroma[i] /= n;
  return chroma;
}

// === Audio ===
const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff, sr;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'fmt ') sr = buf.readUInt32LE(off + 12); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }
const totalFrames = Math.floor((buf.length - dataOff) / 4);

console.log('Building NNLS...');
const dict = buildDict(1.0, 10);
const H = precomputeH(dict);

function processAndEval(label, startTime, dur, trackFilter, windowTicks, sharpen) {
  const { gtC, adjStart, nWin } = getGtChordsFiltered(startTime, dur, trackFilter, windowTicks);
  
  // Audio processing: compute all FFT frames, then accumulate per window
  const ss = Math.round(startTime * SR);
  const ds = Math.round(dur * SR);
  const mono = new Float64Array(ds);
  for (let i = 0; i < ds && ss + i < totalFrames; i++) { const idx = (ss + i) * 2; mono[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
  const tf = Math.floor((ds - FFT_SIZE) / HOP) + 1;
  const rawSpec = [];
  for (let fi = 0; fi < tf; fi++) {
    const frame = mono.slice(fi * HOP, fi * HOP + FFT_SIZE);
    const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
    for (let i = 0; i < frame.length; i++) re[i] = frame[i] * win[i];
    fft(re, im, FFT_SIZE); const m = new Float64Array(HALF);
    for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) * eqWeight[i];
    rawSpec.push(m);
  }
  const specHarm = hpss(rawSpec);
  
  const detC = new Array(nWin).fill('N');
  let correct = 0, rootMatch = 0, total = 0;
  const winFrames = Math.round(windowTicks / tickPerSec * SR / HOP);
  
  for (let w = 0; w < nWin; w++) {
    if (gtC[w] === 'N') continue;
    total++;
    
    // Audio window: from adjTickStart + w * windowTicks
    const wsTick = adjStart + w * windowTicks;
    const weTick = wsTick + windowTicks;
    const ws = Math.max(0, (wsTick / tickPerSec) - startTime);
    const we = (weTick / tickPerSec) - startTime;
    
    const fStart = Math.round(ws * SR / HOP);
    const fEnd = Math.min(tf, Math.round(we * SR / HOP));
    
    const accum = new Float64Array(HALF); let fc = 0;
    for (let fi = fStart; fi < fEnd; fi++) { const m = specHarm[fi]; for (let i = 0; i < HALF; i++) accum[i] += m[i]; fc++; }
    if (fc) for (let i = 0; i < HALF; i++) accum[i] /= fc;
    
    const chroma = nnlsChroma(dict, H, accum, 100, sharpen);
    const det = matchChord(chroma);
    detC[w] = det;
    if (det === gtC[w]) correct++;
    if (rootOf(det) === rootOf(gtC[w])) rootMatch++;
  }
  
  const acc = (correct / total * 100) || 0;
  const rootAcc = (rootMatch / total * 100) || 0;
  console.log(`${label}: ${acc.toFixed(1)}% (${correct}/${total}), 根音=${rootAcc.toFixed(1)}%`);
  if (nWin <= 25) {
    console.log(`  GT: ${gtC.filter(c=>c!=='N').join(' → ')}`);
    console.log(`  Det: ${detC.filter(d=>d!=='N').join(' → ')}`);
  }
  return { acc, rootAcc, total, correct, rootMatch };
}

console.log('\n=== T5 (200-210s) ===');
processAndEval('0.5s 固定窗 (all GT)', 200, 10, n => true, Math.round(0.5 * tickPerSec), 1.5);
processAndEval('0.5s 固定窗 (guitar GT)', 200, 10, n => n.track <= 3, Math.round(0.5 * tickPerSec), 1.5);
processAndEval('1拍 对齐窗 (guitar GT)', 200, 10, n => n.track <= 3, 1 * 480, 1.5);
processAndEval('2拍 对齐窗 (guitar GT)', 200, 10, n => n.track <= 3, 2 * 480, 1.5);
