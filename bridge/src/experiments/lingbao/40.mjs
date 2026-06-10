// Experiment 40: waveform-sim — 漏电流合成波形生成器
// Manifest id: waveform-sim
// I/O: { op: 'generate'|'batch', scenario?, sampleRate?, durationMs?, leakLevelMa? } → samples

import { create } from '../lib/report.mjs';

export const META = {
  id: 'waveform-sim',
  name: 'Waveform-Sim — 漏电流合成波形 (无硬件依赖)',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: "generate | batch" },
    { name: 'scenario', type: 'string', required: false, description: "normal | leak | arc | overload" },
    { name: 'durationMs', type: 'number', required: false, default: 200 },
    { name: 'sampleRate', type: 'number', required: false, default: 12800 },
    { name: 'leakStartMs', type: 'number', required: false, default: 50 },
    { name: 'leakLevelMa', type: 'number', required: false, default: 50 },
  ],
  outputs: [
    { name: 'samples', type: 'array' },
    { name: 'sampleRate', type: 'number' },
    { name: 'leakDetected', type: 'boolean' },
    { name: 'stats', type: 'object' },
  ],
  deps: [],
  tags: ['lingbao', 'sim', 'waveform'],
};

// === invariants ===
// - sampleRate 默认 12800
// - 漏电幅值 mA → 电压: V = mA / 30 (CT 变比)
// - 输出 Float32Array 长度 = sampleRate * durationMs / 1000
// - 场景 'leak' 必含 ≥1 个 50Hz 周期内漏电尖峰
// - noiseDb → 电压幅度: amp = 10^(dB/20)
export async function run({ inputs = {} } = {}) {
  const { op = 'generate', ...args } = inputs;
  const sim = await import('./lib/waveform-sim.mjs');

  if (op === 'generate') {
    const r = sim.generate(args);
    return { outputs: { ...r, samples: Array.from(r.samples) } };
  }
  if (op === 'batch') {
    const { count = 10, ...rest } = args;
    const results = [];
    for (let i = 0; i < count; i++) {
      const r = sim.generate({ ...rest, leakStartMs: (i * 10) + 50 });
      results.push({ ...r, samples: Array.from(r.samples) });
    }
    return { outputs: { batch: results, count } };
  }
  throw new Error(`waveform-sim.run: unknown op "${op}"`);
}

const NAME = 'Waveform-Sim — 漏电流合成';

async function test() {
  const { ok, ng, report } = create();
  let sim;
  try {
    sim = await import('./lib/waveform-sim.mjs');
    ok('waveform-sim.mjs 可加载');
  } catch (e) {
    ng('lib 加载失败', e);
    return report(NAME);
  }

  // 1. 基础生成
  try {
    const r = sim.generate({ durationMs: 200, leakStartMs: 50, leakLevelMa: 50, sampleRate: 12800 });
    const expected = Math.floor((12800 * 200) / 1000);
    if (r.samples.length === expected) ok(`generate 长度: ${r.samples.length}`);
    else ng(`长度错: ${r.samples.length} != ${expected}`);
    if (r.leakDetected === true) ok('leakDetected=true (50mA > 30mA 阈值)');
    else ng('leakDetected 错');
    if (r.stats.rms > 0 && r.stats.peak > 0) ok(`stats: rms=${r.stats.rms.toFixed(3)}, peak=${r.stats.peak.toFixed(3)}`);
    else ng('stats 异常');
  } catch (e) {
    ng('generate 失败', e);
  }

  // 2. 场景 normal (无漏电)
  try {
    const r = sim.generate({ durationMs: 100, leakLevelMa: 0, scenario: 'normal' });
    if (r.leakDetected === false) ok('normal 场景 leakDetected=false');
    else ng('normal 场景误报漏电');
  } catch (e) {
    ng('normal 场景失败', e);
  }

  // 3. 场景 arc
  try {
    const r = sim.generate({ durationMs: 100, scenario: 'arc', leakLevelMa: 0 });
    if (r.samples.length > 0) ok(`arc 场景生成 ${r.samples.length} samples`);
    else ng('arc 场景空');
  } catch (e) {
    ng('arc 失败', e);
  }

  // 4. 边界: durationMs < 50
  try {
    sim.generate({ durationMs: 10 });
    ng('durationMs<50 应抛异常');
  } catch (e) {
    ok(`durationMs<50 拦截: ${e.message.substring(0, 40)}`);
  }

  // 5. 边界: 漏电 < 30mA 不触发
  try {
    const r = sim.generate({ durationMs: 200, leakStartMs: 50, leakLevelMa: 20 });
    if (r.leakDetected === false) ok('20mA 不触发 leakDetected (阈值 30mA)');
    else ng('20mA 误触发');
  } catch (e) {
    ng('低漏电测试失败', e);
  }

  // 6. batch 接口
  try {
    const r = await run({ inputs: { op: 'batch', durationMs: 100, leakLevelMa: 50, count: 5 } });
    if (r.outputs.batch.length === 5) ok(`batch=5 生成 ${r.outputs.batch.length} 条`);
    else ng(`batch 长度: ${r.outputs.batch.length}`);
  } catch (e) {
    ng('batch 失败', e);
  }

  // 7. run() 契约
  try {
    const r = await run({ inputs: { op: 'generate', durationMs: 200, leakStartMs: 50, leakLevelMa: 50 } });
    if (Array.isArray(r.outputs.samples) && r.outputs.samples.length > 0) ok(`run(generate) → ${r.outputs.samples.length} samples`);
    else ng('run(generate) 输出错');
  } catch (e) {
    ng('run 失败', e);
  }

  report(NAME);
}

export { test };
