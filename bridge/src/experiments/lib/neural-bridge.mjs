// neural-bridge.mjs — 进程内 NeuralBrain 单例 (always-on)
//
// 设计 (Step 4, L2 局部):
//   1. singleton — 进程内 1 个 NeuralBrain 实例, 避免每 call new 8KB 权重
//   2. always-on — 默认启用. brain 未训时预测是 noise, 但 22.mjs 已容错 (null 时走 base)
//   3. 3 API:    predict(text) / adaptTools / adaptMaxRounds / trainOnOutcome
//   4. 持久化    — NeuralBrain 内部管 ~/.openchat/brain/weights.json
//
// 调用方 (22.mjs / tool-loop) 在 processText 入口调 predict, loop 中调 adapt*,
// 出口调 trainOnOutcome. 跑得越多预测越准, 无需 opt-in.

import { NeuralBrain } from '../../core/memory/neural-brain.js';

let _instance = null;
let _enabled = false;

const READ_ONLY_TOOLS = new Set([
  'read_file', 'grep', 'code_search', 'ast_find_refs', 'find_refs',
  'ast_index', 'ast_search', 'ast_extract', 'ts_typecheck', 'lint_run',
  'test_run', 'test_discover', 'docs_suggest', 'env_diff', 'sec_audit',
  'ci_detect', 'git_log',
]);

const ROUNDS_BY_DIFFICULTY = [10, 15, 20, 30]; // easy → hard

export function init({ enabled = true } = {}) {
  if (_instance) return _instance;
  _enabled = enabled;
  _instance = new NeuralBrain();
  console.debug(`[neural-bridge] always-on (samples=${_instance.trainingSamples}, accuracy=${(_instance.accuracy * 100).toFixed(1)}%)`);
  return _instance;
}

// 暴露给 env 变化时动态切 (测试 / 单 run override)
export function setEnabled(on) { _enabled = !!on; }

export function isEnabled() { return _enabled && !!_instance; }

export function predict(text) {
  if (!_enabled || !_instance) return null;
  return {
    difficulty: _instance.predictDifficulty(text),  // 0-3
    domain: _instance.predictDomain(text),           // math/logic/research/code_review
    canLocal: _instance.canSolveLocally(text),
    samples: _instance.trainingSamples,
  };
}

export function adaptTools(tools, domain) {
  if (!_enabled || !_instance) return tools;
  if (domain !== 'code_review') return tools;
  return tools.filter(t => READ_ONLY_TOOLS.has(t.function?.name));
}

export function adaptMaxRounds(base, difficulty) {
  if (!_enabled || !_instance) return base;
  if (typeof difficulty !== 'number' || difficulty < 0 || difficulty > 3) return base;
  return ROUNDS_BY_DIFFICULTY[difficulty];
}

export function trainOnOutcome({ text, predicted, success, error } = {}) {
  if (!_enabled || !_instance) return null;
  if (!text || !predicted) return null;
  // 失败时: 难度升 1 档, 领域换 logic (代表"判断错")
  const domain = success ? predicted.domain : 'logic';
  const diff = success
    ? predicted.difficulty
    : Math.min(3, (predicted.difficulty ?? 1) + 1);
  const r = _instance.trainOnSolvedProblems([{ question: text, domain, difficulty: diff }]);
  if (error) r.lastError = error.slice(0, 80);
  return r;
}

export function getStats() {
  if (!_instance) return null;
  return _instance.getStats();
}
