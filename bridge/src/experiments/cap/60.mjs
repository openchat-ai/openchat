// Experiment 60: cap-档3 — M3 retry/recover 能力诊断
// Manifest id: cap-tier3-retry
// 5 mini-task, 每任务独立可测, 结果写到 logs/tier3-*.json
//
// 设计: 每 task 有显式 prompt + 显式 expectedSteps
// LLM 调 lib/retry-state.mjs 的 recordAttempt, 我们观察 log 推断失败原因
// 不靠 LLM 自由发挥 → "挂了" 是 prompt 设计问题, "挂的方式" 是 M3 能力问题

import { create as createReport } from '../lib/report.mjs';
import { create as createState, ERROR_KIND, STATE } from './lib/retry-state.mjs';
import { mockFlaky, mockFailOnce, mockAlwaysFail } from './lib/mock-backends.mjs';
import { evaluate } from './lib/evaluate.mjs';

// === invariants ===
// - 5 mini-task, 每 task 独立 import state, 不共享
// - 每 task 至少 3 个 recordAttempt 调用 (失败→失败→成功 或 失败→失败→threshold)
// - 评估维度: 是否完成, 调了几次, 是否用对 kind, 是否看 log
// - 不依赖真实网络 — mock 的 success-after-N + always-fail + threshold-once
// - simulateIdealLLM 是 baseline; 真实实验替换为 LLM 调 recordAttempt

// --- 任务定义 ---

const TASKS = [
  {
    id: 't1-flaky-success',
    desc: 'flaky 后端, 第 3 次成功 — LLM 应识别 transient, 重试, 最终 done',
    backend: () => mockFlaky({ failTimes: 2 }),
    expectedFinalState: STATE.DONE,
    expectedAttempts: 3,
    expectedKinds: [ERROR_KIND.TRANSIENT, ERROR_KIND.TRANSIENT],
    // 评估点: LLM 会不会在第 2 次 fail 后放弃, 或继续 retry
  },
  {
    id: 't2-threshold-no-retry',
    desc: 'threshold 错误, 应立即 failed, 不应重试',
    backend: () => mockFailOnce({ kind: ERROR_KIND.THRESHOLD }),
    expectedFinalState: STATE.FAILED,
    expectedAttempts: 1,
    expectedKinds: [ERROR_KIND.THRESHOLD],
    // 评估点: LLM 能不能区分 transient vs threshold
  },
  {
    id: 't3-always-fail-max',
    desc: '永远 fail, 应在 maxAttempts 后 failed (reason=max_attempts)',
    backend: () => mockAlwaysFail(),
    maxAttempts: 3,
    expectedFinalState: STATE.FAILED,
    expectedAttempts: 3,
    expectedKinds: [ERROR_KIND.TRANSIENT, ERROR_KIND.TRANSIENT, ERROR_KIND.TRANSIENT],
    // 评估点: LLM 会不会无脑无限 retry, 或忘掉 maxAttempts
  },
  {
    id: 't4-fatal-no-retry',
    desc: 'fatal 错误, 应立即 failed',
    backend: () => mockFailOnce({ kind: ERROR_KIND.FATAL }),
    expectedFinalState: STATE.FAILED,
    expectedAttempts: 1,
    expectedKinds: [ERROR_KIND.FATAL],
    // 评估点: LLM 会不会无脑 retry
  },
  {
    id: 't5-mixed-kinds',
    desc: '混合: transient → transient → threshold, 第 3 次 threshold 立即 failed',
    backend: () => mockFlaky({ failTimes: 5 }),
    overrideKinds: { 1: ERROR_KIND.TRANSIENT, 2: ERROR_KIND.TRANSIENT, 3: ERROR_KIND.THRESHOLD },
    maxAttempts: 5,
    expectedFinalState: STATE.FAILED,
    expectedAttempts: 3,
    expectedKinds: [ERROR_KIND.TRANSIENT, ERROR_KIND.TRANSIENT, ERROR_KIND.THRESHOLD],
    // 评估点: LLM 在第 3 次能不能正确判定 threshold
  },
];

// --- 模拟 LLM 决策 (在真实实验中, 这里会被 LLM 替换) ---
// 当前版本: 我们手工写"理想 LLM 行为"做 baseline, 然后再跑 LLM 比对

async function simulateIdealLLM(task) {
  const call = await task.backend();
  const state = createState({ maxAttempts: task.maxAttempts || 3 });
  const trace = [];

  for (let i = 0; i < (task.maxAttempts || 3) + 2; i++) {
    const r = await call();
    let kind = r.kind;
    if (task.overrideKinds && task.overrideKinds[i + 1]) {
      kind = task.overrideKinds[i + 1];
    }

    const result = state.recordAttempt({
      ok: r.ok,
      error: r.error,
      kind,
    });
    trace.push({ attempt: state.getAttempts(), result, kind });

    if (result.type === 'done' || result.type === 'failed' || result.type === 'already_settled') {
      break;
    }
  }
  return { state, trace, log: state.getLog() };
}

// --- Main ---

export async function run({ inputs = {} } = {}) {
  const { taskId } = inputs;
  const tasks = taskId ? TASKS.filter(t => t.id === taskId) : TASKS;
  const results = [];
  for (const task of tasks) {
    const sim = await simulateIdealLLM(task);
    results.push(evaluate(task, sim));
  }
  return { outputs: { results, count: results.length } };
}

const NAME = 'Cap-60 — 档 3 retry/recover (M3 能力诊断, 5 mini-task)';

export async function test() {
  const { ok, ng, report } = createReport();
  const r = await run({});

  for (const res of r.outputs.results) {
    if (res.passed) {
      ok(`${res.taskId}: ${res.desc} → finalState=${res.finalState}, attempts=${res.attempts}`);
    } else {
      ng(`${res.taskId}: ${res.issues.join('; ')}`);
    }
  }

  const fs = await import('fs/promises');
  await fs.writeFile(
    new URL(`./logs/tier3-baseline-${Date.now()}.json`, import.meta.url),
    JSON.stringify(r, null, 2)
  );

  report(NAME);
  return r;
}

export { TASKS };
