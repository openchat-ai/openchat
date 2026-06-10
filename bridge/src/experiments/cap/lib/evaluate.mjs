// lib/evaluate.mjs — 60.mjs 评估器
// 评估维度: finalState / attempts / kind 序列
// 不看延迟, 不看 log 长度

import { STATE } from './retry-state.mjs';

// === invariants ===
// - 评估只看 state 内部 + log[event='attempt'] 序列
// - issues 用数组收集, passed = issues.length === 0
// - 失败原因从 cap/logs/failure-taxonomy.json 的 taxonomy 选

export function evaluate(task, simResult) {
  const issues = [];
  const finalState = simResult.state.getState();
  const attempts = simResult.state.getAttempts();

  if (finalState !== task.expectedFinalState) {
    issues.push(`finalState: got ${finalState}, expected ${task.expectedFinalState}`);
  }
  if (attempts !== task.expectedAttempts) {
    issues.push(`attempts: got ${attempts}, expected ${task.expectedAttempts}`);
  }

  const attemptLogs = simResult.log.filter(e => e.event === 'attempt');
  for (let i = 0; i < task.expectedKinds.length; i++) {
    const got = attemptLogs[i]?.kind;
    const exp = task.expectedKinds[i];
    if (got !== exp) {
      issues.push(`attempt ${i+1} kind: got ${got}, expected ${exp}`);
    }
  }

  return {
    taskId: task.id,
    desc: task.desc,
    passed: issues.length === 0,
    issues,
    finalState,
    attempts,
    trace: simResult.trace,
    log: simResult.log,
  };
}
