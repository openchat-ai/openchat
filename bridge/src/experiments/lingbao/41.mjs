// Experiment 41: signal-algo — 互相关/FFT/漏电检测/电弧能量
// Manifest id: signal-algo
// I/O: { op, samples, sampleRate, leakStartMs? } → 分析结果

import { create } from '../lib/report.mjs';

export const META = {
  id: 'signal-algo',
  name: 'Signal-Algo — 互相关/FFT/漏电检测/电弧能量',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: "crossCorrelate | detectLeak | fft | arcEnergy" },
    { name: 'samples', type: 'array', required: true },
    { name: 'sampleRate', type: 'number', required: false, default: 12800 },
    { name: 'leakStartMs', type: 'number', required: false },
  ],
  outputs: [
    { name: 'result', type: 'object' },
  ],
  deps: ['waveform-sim'],
  tags: ['lingbao', 'algo', 'signal'],
};

// === invariants ===
// - FFT: Cooley-Tukey 递归, N 补零到 2^k
// - crossCorrelate: 归一化到 [-1, 1]
// - arc: ratio > 0.15 → isArc
// - detectLeak 步长 = sr/100
export async function run({ inputs = {} } = {}) {
  const { op, samples, sampleRate = 12800, ...rest } = inputs;
  if (!op) throw new Error('signal-algo.run: op required');
  if (!samples || !Array.isArray(samples) && !ArrayBuffer.isView(samples)) {
    throw new Error('signal-algo.run: samples required');
  }
  const arr = samples instanceof Float32Array ? samples : Float32Array.from(samples);
  const algo = await import('./lib/signal-algo.mjs');

  switch (op) {
    case 'crossCorrelate': {
      const { b, maxLag } = rest;
      if (!b) throw new Error('crossCorrelate requires b');
      const bArr = b instanceof Float32Array ? b : Float32Array.from(b);
      return { outputs: { result: algo.crossCorrelate(arr, bArr, maxLag) } };
    }
    case 'detectLeak': {
      return { outputs: { result: algo.detectLeak(arr, sampleRate, rest.thresholdMa) } };
    }
    case 'fft': {
      return { outputs: { result: algo.fftOnSamples(arr) } };
    }
    case 'arcEnergy': {
      return { outputs: { result: algo.arcEnergy(arr, sampleRate, rest.bandHz) } };
    }
    default:
      throw new Error(`signal-algo.run: unknown op "${op}"`);
  }
}

const NAME = 'Signal-Algo — 信号处理';

async function test() {
  const { ok, ng, report } = create();
  let algo, sim;
  try {
    algo = await import('./lib/signal-algo.mjs');
    ok('signal-algo.mjs 可加载');
  } catch (e) {
    ng('lib 加载失败', e);
    return report(NAME);
  }
  try {
    sim = await import('./lib/waveform-sim.mjs');
    ok('依赖 40.waveform-sim 可加载');
  } catch (e) {
    ng('依赖 40 加载失败', e);
  }

  // 1. 互相关: b 是 a 延迟 10 sample (b[i+10] = a[i]) → crossCorrelate(a,b) 应在 lag=-10 峰值
  //    因为 corr(a, b, lag) = sum a[i] * b[i-lag]; lag=-10 时 b[i+10] = a[i] 完美匹配
  try {
    const a = sim.generate({ durationMs: 200, leakStartMs: 50, leakLevelMa: 50 });
    const aArr = a.samples;
    const bArr = new Float32Array(aArr.length);
    for (let i = 0; i < aArr.length - 10; i++) bArr[i + 10] = aArr[i];
    const r = algo.crossCorrelate(aArr, bArr);
    if (r.lag === -10) ok(`crossCorrelate 命中 lag=-10 (b 晚 a 10 sample), peak=${r.peak.toFixed(3)}`);
    else ng(`lag 错: ${r.lag}, 期望 -10 (b 延迟 a 10 sample)`);
    if (r.confidence > 0.5) ok(`confidence=${r.confidence.toFixed(3)} > 0.5`);
    else ng(`confidence 低: ${r.confidence}`);
  } catch (e) {
    ng('crossCorrelate 失败', e);
  }

  // 2. 漏电检测: 50mA 应触发
  try {
    const a = sim.generate({ durationMs: 200, leakStartMs: 50, leakLevelMa: 50 });
    const r = algo.detectLeak(a.samples, 12800);
    if (r.triggered === true) ok(`detectLeak 50mA 触发, peakMa=${r.peakMa.toFixed(1)}`);
    else ng('50mA 未触发');
    if (r.startIdx > 0) ok(`startIdx=${r.startIdx} > 0`);
    else ng(`startIdx=${r.startIdx}`);
  } catch (e) {
    ng('detectLeak 失败', e);
  }

  // 3. 漏电检测: 0mA 不触发
  try {
    const a = sim.generate({ durationMs: 200, leakLevelMa: 0 });
    const r = algo.detectLeak(a.samples, 12800);
    if (r.triggered === false) ok('0mA 不触发');
    else ng('0mA 误触发');
  } catch (e) {
    ng('detectLeak 0mA 失败', e);
  }

  // 4. FFT: 50Hz 合成波应峰值在 ~50Hz
  try {
    const a = sim.generate({ durationMs: 500, leakLevelMa: 0 });
    const r = algo.fftOnSamples(a.samples);
    if (r.peakFreq > 30 && r.peakFreq < 80) ok(`FFT peakFreq=${r.peakFreq.toFixed(1)}Hz (50Hz ± 30)`);
    else ng(`peakFreq 偏离: ${r.peakFreq}`);
  } catch (e) {
    ng('fft 失败', e);
  }

  // 5. 电弧能量: arc 场景应 isArc=true (检测频段 3-6kHz, 匹配合成谐波)
  try {
    const a = sim.generate({ durationMs: 200, scenario: 'arc' });
    const r = algo.arcEnergy(a.samples, 12800, [3000, 6000]);
    if (r.isArc === true) ok(`arc 场景 isArc=true, ratio=${r.ratio.toFixed(3)}`);
    else ng(`arc 漏检: ratio=${r.ratio}`);
  } catch (e) {
    ng('arcEnergy 失败', e);
  }

  // 6. 电弧能量: normal 场景应 isArc=false
  try {
    const a = sim.generate({ durationMs: 200, scenario: 'normal' });
    const r = algo.arcEnergy(a.samples, 12800);
    if (r.isArc === false) ok('normal 场景 isArc=false');
    else ng('normal 误报 arc');
  } catch (e) {
    ng('arcEnergy normal 失败', e);
  }

  // 7. run() 契约
  try {
    const a = sim.generate({ durationMs: 200, leakStartMs: 50, leakLevelMa: 50 });
    const r = await run({ inputs: { op: 'detectLeak', samples: Array.from(a.samples), sampleRate: 12800 } });
    if (r.outputs.result.triggered === true) ok('run(detectLeak) 契约 OK');
    else ng('run(detectLeak) 输出错');
  } catch (e) {
    ng('run 失败', e);
  }

  // 8. 边界: 数组过短
  try {
    algo.fftOnSamples(new Float32Array(32));
    ng('过短应抛异常');
  } catch (e) {
    ok(`过短拦截: ${e.message.substring(0, 40)}`);
  }

  report(NAME);
}

export { test };
