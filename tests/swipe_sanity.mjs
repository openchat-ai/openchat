// swipe_sanity.mjs — Quick SWIPE sanity check
import fs from 'fs';

const SR = 48000, FFT_SIZE = 2048, HALF = 1024, NOTE_MIN = 21, NOTE_MAX = 108, NOTE_COUNT = 88;
const win = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / FFT_SIZE));

function fft(re, im, n) {
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let l = 2; l <= n; l <<= 1) { const a = -2 * Math.PI / l; for (let i = 0; i < n; i += l) { for (let j = 0; j < l >> 1; j++) { const u = i + j, v = i + j + (l >> 1); const wr = Math.cos(a * j), wi = Math.sin(a * j); const tr = wr * re[v] - wi * im[v], ti = wr * im[v] + wi * re[v]; re[v] = re[u] - tr; im[v] = im[u] - ti; re[u] += tr; im[u] += ti; } } }
}
function computeMag(s) {
  const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
  for (let i = 0; i < Math.min(s.length, FFT_SIZE); i++) re[i] = s[i] * win[i];
  fft(re, im, FFT_SIZE);
  const m = new Float64Array(HALF); for (let i = 0; i < HALF; i++) m[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); return m;
}

const buf = fs.readFileSync('jzlg.wav');
let off = 12, dataOff, sr;
while (off < buf.length) { const id = buf.toString('ascii', off, off + 4); const sz = buf.readUInt32LE(off + 4); if (id === 'fmt ') sr = buf.readUInt32LE(off + 12); if (id === 'data') { dataOff = off + 8; break; } off += 8 + sz; }

// First frame (without any filtering - raw frame)
const frame0 = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) { const idx = i * 2; frame0[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
const mag0 = computeMag(frame0);
let maxBin0 = 0; for (let i = 0; i < HALF; i++) if (mag0[i] > mag0[maxBin0]) maxBin0 = i;
console.log('First frame mag peak:', mag0[maxBin0].toFixed(2), 'at bin', maxBin0);

// Frame at 10s (guitar section)
const start = 10 * SR;
const frame10 = new Float64Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) { const idx = (start + i) * 2; frame10[i] = buf.readInt16LE(dataOff + idx * 2) / 32768 * 0.5 + buf.readInt16LE(dataOff + (idx + 1) * 2) / 32768 * 0.5; }
// High-pass for guitar
const hp = new Float64Array(FFT_SIZE); let y = 0; const a = 1 - 2 * Math.PI * 200 / SR;
for (let i = 1; i < FFT_SIZE; i++) { y = frame10[i] - frame10[i - 1] + a * y; hp[i] = y; }
const mag10 = computeMag(hp);
let maxBin = 0; for (let i = 0; i < HALF; i++) if (mag10[i] > mag10[maxBin]) maxBin = i;
console.log('10s frame mag peak:', mag10[maxBin].toFixed(2), 'at bin', maxBin);

// NNLS dictionary
const dict = new Array(HALF); for (let b = 0; b < HALF; b++) dict[b] = new Float64Array(NOTE_COUNT);
for (let ni = 0; ni < NOTE_COUNT; ni++) {
  const freq = 440 * Math.pow(2, (NOTE_MIN + ni - 69) / 12);
  for (let h = 1; h <= 10; h++) { const hf = freq * h; if (hf > SR / 2) break; const bin = Math.round(hf * FFT_SIZE / SR); if (bin >= 0 && bin < HALF) dict[bin][ni] += Math.pow(h, -1.0); }
}
for (let ni = 0; ni < NOTE_COUNT; ni++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][ni] * dict[b][ni]; const n = Math.sqrt(s) || 1; for (let b = 0; b < HALF; b++) dict[b][ni] /= n; }

// NNLS g vector
const gArray = [];
for (let i = 0; i < NOTE_COUNT; i++) { let s = 0; for (let b = 0; b < HALF; b++) s += dict[b][i] * mag10[b]; gArray.push({ ni: i, midi: NOTE_MIN + i, v: Math.max(s, 1e-12) }); }
const topN = gArray.sort((a,b) => b.v - a.v).slice(0, 8);
console.log('\nNNLS top8:', topN.map(n => n.midi + '(' + n.v.toFixed(3) + ')').join(' '));

// SWIPE 迭代谱减多音检测
function buildSwipeKernel(harmCount) {
  // For each note, precompute kernel vector (normalized sawtooth)
  return Array.from({ length: NOTE_COUNT }, (_, ni) => {
    const f0 = 440 * Math.pow(2, (NOTE_MIN + ni - 69) / 12);
    const kv = new Float64Array(HALF);
    let ee = 0;
    for (let h = 1; h <= harmCount; h++) {
      const hf = f0 * h; if (hf > SR / 2) break;
      const eb = hf * FFT_SIZE / SR; if (eb >= HALF - 1) break;
      const b = Math.round(eb);
      const w = 1 / h;
      kv[b] += w; ee += w * w;
    }
    const n = Math.sqrt(ee) || 1;
    for (let b = 0; b < HALF; b++) kv[b] /= n;
    return kv;
  });
}

function swipeIterDetect(mag, kernels, harmCount, maxNotes) {
  let residual = new Float64Array(mag);
  const found = [];

  for (let iter = 0; iter < maxNotes; iter++) {
    // Dot product with each kernel
    let best = -1, bestScore = 0;
    for (let ni = 0; ni < NOTE_COUNT; ni++) {
      let dot = 0;
      for (let b = 0; b < HALF; b++) dot += residual[b] * kernels[ni][b];
      if (dot > bestScore) { bestScore = dot; best = ni; }
    }
    if (best < 0 || bestScore < 0.01) break;

    // Subtract best kernel (scaled)
    let scale = 0, kDot = 0;
    for (let b = 0; b < HALF; b++) { scale += residual[b] * kernels[best][b]; kDot += kernels[best][b] * kernels[best][b]; }
    const amp = kDot > 0 ? scale / kDot : 0;
    if (amp < 0.001) break;

    for (let b = 0; b < HALF; b++) residual[b] = Math.max(0, residual[b] - amp * kernels[best][b]);
    found.push({ midi: NOTE_MIN + best, amp });
  }
  return found;
}

const kernels = buildSwipeKernel(10);
const swipeNotes = swipeIterDetect(mag10, kernels, 10, 6);
console.log('SWIPE iterative:', swipeNotes.map(n => n.midi + '(' + n.amp.toFixed(3) + ')').join(' '));

