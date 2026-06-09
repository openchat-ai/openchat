// Experiment 48: guardian — 守卫层中间件
// 可被 compose.mjs pipeline() 编排，注入 agent 的 processText 作为 opt.guardian
// === invariants ===
// - run() 返回 guardian 实例，不持状态（每次调用新建）
// - guardian 内部持状态（callCount/enforcer/tracker），跨会话需手动 reset

import { createGuardian } from './lib/guardian.mjs';
import { TOOLS as CODING_TOOLS } from '../tools/coding-tools.mjs';

export const META = {
  id: 'guardian',
  name: 'Guardian — 守卫层中间件',
  status: 'closed-loop',
  needsEnv: [],
  inputs: [],
  outputs: [
    { name: 'guardian', type: 'object', description: 'guardian 实例（wrap/validateResponse/reset）' },
  ],
  deps: [],
  tags: ['guardian', 'middleware'],
};

export async function run({ deps = {} } = {}) {
  const guardian = createGuardian({
    tools: CODING_TOOLS,
    stepDeps: { edit_file: ['read_file'], hash_edit: ['read_file'], write_file: ['read_file'] },
  });
  return { outputs: { guardian } };
}

import { create } from './lib/report.mjs';
const { ok, ng, report } = create();

async function test() {
  const result = await run();
  const g = result.outputs.guardian;
  if (g && typeof g.wrap === 'function' && typeof g.validateResponse === 'function') {
    ok('guardian 实例正确（有 wrap 和 validateResponse）');
  } else {
    ng('guardian 实例不正确');
  }
  report('Guardian Middleware');
}

export { test };
