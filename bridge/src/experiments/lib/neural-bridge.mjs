// neural-bridge.mjs — 进程内 NeuralBrain 单例 + opt-in 接入层
//
// 设计 (Step 4, L2 局部):
//   1. singleton — 进程内 1 个 NeuralBrain 实例, 避免每 call new 8KB 权重
//   2. opt-in    — env OPENCHAT_NEURAL_BRAIN=1 才启用, 默认 0 行为变化
//   3. 3 API:    predict(text) / adaptTools / adaptMaxRounds / trainOnOutcome
//   4. 持久化    — NeuralBrain 内部管 ~/.openchat/brain/weights.json
//
// 调用方 (22.mjs / tool-loop) 在 processText 入口调 predict, loop 中调 adapt*,
// 出口调 trainOnOutcome. 未启用时全部 early return, 0 副作用.

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

export function init({ enabled = process.env.OPENCHAT_NEURAL_BRAIN === '1' } = {}) {
  if (_instance) return _instance;
  _enabled = enabled;
  _instance = new NeuralBrain();
  if (_enabled) {
    console.log(`[neural-bridge] enabled (samples=${_instance.trainingSamples}, accuracy=${(_instance.accuracy * 100).toFixed(1)}%)`);
  }
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
