// Experiment 45: calendar-parse — 施工日历解析+阈值动态调整
// Manifest id: calendar-parse
// I/O: { op: 'parse'|'suggest', calendar, thresholds?, currentDate? }

import { create } from '../lib/report.mjs';

export const META = {
  id: 'calendar-parse',
  name: 'Calendar-Parse — 施工日历+阈值动态调整',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [
    { name: 'op', type: 'string', required: true, description: "parse | suggest" },
    { name: 'calendar', type: 'array', required: true },
    { name: 'thresholds', type: 'object', required: false },
    { name: 'currentDate', type: 'string', required: false },
  ],
  outputs: [
    { name: 'days', type: 'number' },
    { name: 'phases', type: 'object' },
    { name: 'suggestions', type: 'array' },
  ],
  deps: [],
  tags: ['lingbao', 'calendar', 'threshold'],
};

// === invariants ===
// - phase 枚举: concrete, lifting, finishing, rest, unknown
// - 默认 thresholds: { leakMa: 30, arcEnergy: 0.15, overloadKw: 50 }
export async function run({ inputs = {} } = {}) {
  const { op, calendar, thresholds, currentDate } = inputs;
  if (!op) throw new Error('calendar-parse.run: op required');
  const lib = await import('./lib/calendar-parse.mjs');
  if (op === 'parse') return { outputs: lib.parse(calendar || []) };
  if (op === 'suggest') return { outputs: lib.suggest(calendar || [], thresholds, currentDate) };
  throw new Error(`calendar-parse.run: unknown op "${op}"`);
}

const NAME = 'Calendar-Parse — 施工日历';

async function test() {
  const { ok, ng, report } = create();
  let lib;
  try {
    lib = await import('./lib/calendar-parse.mjs');
    ok('calendar-parse.mjs 可加载');
  } catch (e) {
    ng('lib 加载失败', e);
    return report(NAME);
  }

  const sample = [
    { date: '2026-06-10', phase: '浇筑', equipmentLoadKw: 80 },
    { date: '2026-06-11', phase: '浇筑', equipmentLoadKw: 85 },
    { date: '2026-06-12', phase: '吊装', equipmentLoadKw: 40 },
    { date: '2026-06-13', phase: '吊装', equipmentLoadKw: 45 },
    { date: '2026-06-14', phase: '收尾', equipmentLoadKw: 20 },
    { date: '2026-06-15', phase: '收尾', equipmentLoadKw: 25 },
    { date: '2026-06-16', phase: '休整', equipmentLoadKw: 5 },
  ];

  // 1. parse 统计
  try {
    const r = lib.parse(sample);
    if (r.days === 7) ok(`parse days=7`);
    else ng(`days 错: ${r.days}`);
    if (r.phases.concrete === 2 && r.phases.lifting === 2 && r.phases.finishing === 2 && r.phases.rest === 1) ok(`phases 分布正确`);
    else ng(`phases 错: ${JSON.stringify(r.phases)}`);
    if (r.dateRange && r.dateRange[0] === '2026-06-10' && r.dateRange[1] === '2026-06-16') ok(`dateRange ${r.dateRange[0]} ~ ${r.dateRange[1]}`);
    else ng('dateRange 错');
  } catch (e) {
    ng('parse 失败', e);
  }

  // 2. phase 归一化
  try {
    if (lib.normalizePhase('浇筑') === 'concrete') ok('中文 浇筑→concrete');
    else ng('中文归一错');
    if (lib.normalizePhase('LIFTING') === 'lifting') ok('LIFTING→lifting');
    else ng('英文归一错');
    if (lib.normalizePhase('') === 'unknown') ok('空→unknown');
    else ng('空归一错');
    if (lib.normalizePhase(null) === 'unknown') ok('null→unknown');
    else ng('null 归一错');
  } catch (e) {
    ng('normalize 失败', e);
  }

  // 3. suggest 当前=浇筑日, overloadKw 应+50%
  try {
    const r = lib.suggest(sample, undefined, '2026-06-10');
    if (r.currentPhase === 'concrete') ok('currentPhase=concrete');
    else ng(`currentPhase 错: ${r.currentPhase}`);
    const s = r.suggestions[0];
    if (s.adjusted.overloadKw === 75) ok(`浇筑日 overloadKw 75 (50*1.5)`);
    else ng(`overloadKw 错: ${s.adjusted.overloadKw}`);
    if (s.reason.includes('50%')) ok('reason 提及 50%');
    else ng('reason 缺百分比');
  } catch (e) {
    ng('suggest 浇筑 失败', e);
  }

  // 4. suggest 当前=吊装日, leakMa 应-10%
  try {
    const r = lib.suggest(sample, undefined, '2026-06-12');
    if (r.currentPhase === 'lifting') ok('currentPhase=lifting');
    else ng(`currentPhase 错: ${r.currentPhase}`);
    const s = r.suggestions[0];
    if (s.adjusted.leakMa === 27) ok(`吊装日 leakMa 27 (30*0.9)`);
    else ng(`leakMa 错: ${s.adjusted.leakMa}`);
  } catch (e) {
    ng('suggest 吊装 失败', e);
  }

  // 5. suggest 当前=收尾日, arcEnergy 应-20%
  try {
    const r = lib.suggest(sample, undefined, '2026-06-14');
    const s = r.suggestions[0];
    if (Math.abs(s.adjusted.arcEnergy - 0.12) < 0.001) ok(`收尾日 arcEnergy 0.12 (0.15*0.8)`);
    else ng(`arcEnergy 错: ${s.adjusted.arcEnergy}`);
  } catch (e) {
    ng('suggest 收尾 失败', e);
  }

  // 6. suggest 当前=休整日, 全默认
  try {
    const r = lib.suggest(sample, undefined, '2026-06-16');
    const s = r.suggestions[0];
    if (s.action === '保持默认') ok('休整日 action=保持默认');
    else ng(`休整 action 错: ${s.action}`);
  } catch (e) {
    ng('suggest 休整 失败', e);
  }

  // 7. 未来 7 天预告
  try {
    const r = lib.suggest(sample, undefined, '2026-06-10');
    if (r.suggestions.length > 1) ok(`预告 ${r.suggestions.length - 1} 天`);
    else ng('无预告');
  } catch (e) {
    ng('预告失败', e);
  }

  // 8. 空 calendar
  try {
    const r = lib.parse([]);
    if (r.days === 0 && r.dateRange === null) ok('空 calendar 返回空 stats');
    else ng('空 calendar stats 错');
  } catch (e) {
    ng('空 calendar 失败', e);
  }

  // 9. 自定义 thresholds
  try {
    const r = lib.suggest(sample, { leakMa: 50 }, '2026-06-10');
    // 浇筑日 leakMa 不变 (factor=1.0)
    if (r.suggestions[0].adjusted.leakMa === 50) ok('自定义 thresholds 生效');
    else ng('自定义 thresholds 错');
  } catch (e) {
    ng('自定义 失败', e);
  }

  // 10. run() 契约
  try {
    const r = await run({ inputs: { op: 'parse', calendar: sample } });
    if (r.outputs.days === 7) ok('run(parse) 契约 OK');
    else ng('run(parse) 错');
  } catch (e) {
    ng('run 失败', e);
  }

  report(NAME);
}

export { test };
