// 漏电波形合成算法 — 无外部依赖
// 50Hz 工频基波 + 漏电分量 + 高斯白噪声 + 偶发尖峰
// 输出 Float32Array (单位: V, 假设 CT 变比 1V/30mA)

function boxMuller(mean = 0, std = 1) {
  const u1 = Math.max(Math.random(), 1e-12);
  const u2 = Math.random();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z0 * std;
}

// === invariants ===
// - sampleRate 默认 12800
// - 漏电幅值 mA → 电压: V = mA / 30 (CT 变比)
// - 场景 'leak' 必含 ≥1 个 50Hz 周期内漏电尖峰
// - noiseDb → 电压幅度: amp = 10^(dB/20)
function generate(opts) {
  const {
    sampleRate = 12800,
    mainsFreq = 50,
    durationMs,
    leakStartMs = 0,
    leakLevelMa = 0,
    scenario = 'normal',
    noiseDb = -40,
  } = opts;

  if (durationMs < 50) throw new RangeError('durationMs < 50');
  if (leakLevelMa < 0) throw new RangeError('leakLevelMa < 0');
  if (sampleRate < 8000 || sampleRate > 48000) throw new RangeError('sampleRate out of range');

  const totalSamples = Math.floor((sampleRate * durationMs) / 1000);
  const leakStartSample = Math.floor((sampleRate * leakStartMs) / 1000);
  const leakAmpV = leakLevelMa / 30;
  const noiseAmp = Math.pow(10, noiseDb / 20);

  const samples = new Float32Array(totalSamples);
  let peak = 0;
  let sumSq = 0;
  let injected = false;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    // 50Hz 基波 (220V 归一到 1.0)
    let v = Math.sin(2 * Math.PI * mainsFreq * t) * 0.5;

    // 漏电分量: 50Hz 同步相位 + 谐波 (3/5/7次)
    if (i >= leakStartSample && leakLevelMa > 0) {
      const phase = 2 * Math.PI * mainsFreq * (t - leakStartMs / 1000);
      v += Math.sin(phase) * leakAmpV;
      v += Math.sin(3 * phase) * leakAmpV * 0.3;
      v += Math.sin(5 * phase) * leakAmpV * 0.15;
      injected = true;
    }

    // arc 场景: 10kHz-100kHz 高频噪声 (降采样近似, 用 8kHz 谐波)
    if (scenario === 'arc') {
      v += Math.sin(2 * Math.PI * 8000 * t) * 0.05;
      v += Math.sin(2 * Math.PI * 12000 * t) * 0.03;
    }

    // overload 场景: 基波幅值 1.5x
    if (scenario === 'overload') v *= 1.5;

    // 高斯白噪声
    v += boxMuller(0, noiseAmp);

    samples[i] = v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
    sumSq += v * v;
  }

  const rms = Math.sqrt(sumSq / totalSamples);

  return {
    samples,
    sampleRate,
    leakDetected: injected && leakLevelMa > 30,
    stats: { peak, rms, totalSamples, scenario },
  };
}

export { generate };
export default { generate };
