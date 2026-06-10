// 信号处理算法库 — 纯 JS 零依赖
// 互相关 / FFT / 漏电检测 / 电弧能量

// === invariants ===
// - FFT: Cooley-Tukey 递归, N 补零到 2^k
// - crossCorrelate: 归一化到 [-1, 1]
// - arcEnergy: 8-12kHz/总能量 > 0.15 → isArc
// - detectLeak: 扫描步长 = sr/100 (10ms 窗)
// - 全部纯函数

// Cooley-Tukey FFT (radix-2, 递归)
function fft(re, im) {
  const N = re.length;
  if (N === 1) return;
  if ((N & (N - 1)) !== 0) throw new RangeError('FFT length must be power of 2');

  const halfN = N >> 1;
  const reEven = new Float64Array(halfN);
  const imEven = new Float64Array(halfN);
  const reOdd = new Float64Array(halfN);
  const imOdd = new Float64Array(halfN);

  for (let i = 0; i < halfN; i++) {
    reEven[i] = re[2 * i];
    imEven[i] = im[2 * i];
    reOdd[i] = re[2 * i + 1];
    imOdd[i] = im[2 * i + 1];
  }
  fft(reEven, imEven);
  fft(reOdd, imOdd);

  for (let k = 0; k < halfN; k++) {
    const angle = (-2 * Math.PI * k) / N;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tRe = cos * reOdd[k] - sin * imOdd[k];
    const tIm = sin * reOdd[k] + cos * imOdd[k];
    re[k] = reEven[k] + tRe;
    im[k] = imEven[k] + tIm;
    re[k + halfN] = reEven[k] - tRe;
    im[k + halfN] = imEven[k] - tIm;
  }
}

function fftOnSamples(samples) {
  if (samples.length < 64) throw new RangeError('samples.length < 64');
  // 补零到 2 的幂
  let N = 1;
  while (N < samples.length) N <<= 1;
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < samples.length; i++) re[i] = samples[i];
  fft(re, im);
  const magnitudes = new Float64Array(N);
  let peakFreq = 0;
  let peakMag = 0;
  const sampleRate = 12800;
  for (let k = 0; k < N / 2; k++) {
    magnitudes[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    if (magnitudes[k] > peakMag) {
      peakMag = magnitudes[k];
      peakFreq = (k * sampleRate) / N;
    }
  }
  return { real: Array.from(re.slice(0, N / 2)), imag: Array.from(im.slice(0, N / 2)), magnitudes: Array.from(magnitudes.slice(0, N / 2)), peakFreq };
}

function crossCorrelate(a, b, maxLag) {
  if (a.length !== b.length) throw new RangeError('arrays must have equal length');
  const N = a.length;
  const limit = maxLag != null ? maxLag : N - 1;

  // 归一化
  let aMean = 0, bMean = 0;
  for (let i = 0; i < N; i++) { aMean += a[i]; bMean += b[i]; }
  aMean /= N; bMean /= N;

  let aVar = 0, bVar = 0;
  for (let i = 0; i < N; i++) { aVar += (a[i] - aMean) ** 2; bVar += (b[i] - bMean) ** 2; }
  const norm = Math.sqrt(aVar * bVar) || 1e-12;

  let bestLag = 0;
  let bestPeak = -Infinity;
  for (let lag = -limit; lag <= limit; lag++) {
    let sum = 0;
    const start = Math.max(0, lag);
    const end = Math.min(N, N + lag);
    for (let i = start; i < end; i++) {
      sum += (a[i] - aMean) * (b[i - lag] - bMean);
    }
    const c = sum / norm;
    if (c > bestPeak) { bestPeak = c; bestLag = lag; }
  }
  return { lag: bestLag, peak: bestPeak, confidence: bestPeak };
}

function detectLeak(samples, sampleRate, thresholdMa) {
  const threshold = thresholdMa != null ? thresholdMa : 30; // 直接用 mA 单位
  const windowSize = Math.floor(sampleRate / 100); // 10ms
  let triggered = false;
  let startIdx = -1;
  let endIdx = -1;
  let peakMa = 0;
  let inLeak = false;

  for (let i = 0; i <= samples.length - windowSize; i += windowSize) {
    let peak = 0;
    for (let j = 0; j < windowSize; j++) {
      const abs = Math.abs(samples[i + j]);
      if (abs > peak) peak = abs;
    }
    const peakMaCur = peak * 30; // V → mA (CT 变比 1V/30mA)

    if (peakMaCur > threshold && !inLeak) {
      inLeak = true;
      triggered = true;
      startIdx = i;
    }
    if (peakMaCur > threshold) {
      if (peakMaCur > peakMa) peakMa = peakMaCur;
    } else if (inLeak) {
      inLeak = false;
      endIdx = i;
    }
  }
  if (inLeak) endIdx = samples.length;

  return { triggered, startIdx, endIdx, peakMa };
}

function arcEnergy(samples, sampleRate, bandHz) {
  const band = bandHz || [8000, 12000];
  if (samples.length < 64) throw new RangeError('samples too short');

  const fftRes = fftOnSamples(samples);
  const N = fftRes.magnitudes.length;

  let bandEnergy = 0;
  let totalEnergy = 0;
  for (let k = 0; k < N; k++) {
    const freq = (k * sampleRate) / (2 * N);
    const m = fftRes.magnitudes[k];
    totalEnergy += m;
    if (freq >= band[0] && freq <= band[1]) bandEnergy += m;
  }
  const ratio = totalEnergy > 0 ? bandEnergy / totalEnergy : 0;
  return { energy: bandEnergy, totalEnergy, ratio, isArc: ratio > 0.15 };
}

export { fftOnSamples, crossCorrelate, detectLeak, arcEnergy };
export default { fftOnSamples, crossCorrelate, detectLeak, arcEnergy };
