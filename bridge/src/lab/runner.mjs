// runner.mjs — 拉下一个 pending goal, 跳 openchat --goal, 写 result
//                P2: 失败分类 + auto-retry + escalate
//
// 流程:
//   1. getNextPending() → 拿优先级最高的 pending
//   2. 标 running, 记 startedAt
//   3. spawn `node bin/openchat.mjs --goal <desc>`  (子进程直连 provider, 不占桥端口)
//   4. 子进程 exit → classify(runResult) →
//      - success → done
//      - transient + retryCount < MAX → 重置 pending, retryCount++
//      - 其它 (code/config/unknown) → failed + escalate
//      - transient 但 retryCount >= MAX → failed + escalate

// === invariants ===
// - 单 goal 串行跑 (不并发), lab 假设单用户
// - 子进程 stdio: 'inherit' → 跑 goal 时用户能看见 /goal 的输出
// - exit code 0 = success, 其它 exit = code; signal = transient (多数情况)
// - MAX_RETRIES 改 1 行即可, 默认 2 (共 3 次尝试)
// - 失败 escalate 是 fire-and-forget, 不等返回
// - 同一 goal auto-retry 时 status 回到 pending, getNextPending 下一轮会再 pick 它

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getNextPending, updateGoal } from './goal-queue.mjs';
import { recordRun } from './history.mjs';
import { classify } from './failure-analyzer.mjs';
import { escalate } from './escalate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENCHAT_BIN = join(__dirname, '..', '..', 'bin', 'openchat.mjs');
const MAX_RETRIES = 2;

export async function runNext() {
  const goal = getNextPending();
  if (!goal) return { ok: false, reason: 'no pending goal' };

  const startedAt = Date.now();
  updateGoal(goal.id, { status: 'running', startedAt });

  return new Promise((resolve) => {
    const child = spawn('node', [OPENCHAT_BIN, '--goal', goal.description], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });

    child.on('exit', (code, signal) => {
      const finishedAt = Date.now();
      const result = {
        ok: code === 0,
        exitCode: code,
        signal,
        durationMs: finishedAt - startedAt,  // 用局部变量, 不用 goal.startedAt (那是 pre-update)
      };
      const classification = classify({ exitCode: code, signal });
      const attempt = (goal.retryCount || 0) + 1;
      _finalize(goal, result, classification, attempt, finishedAt);
      resolve({ ok: true, goal, result, classification });
    });

    child.on('error', (err) => {
      const finishedAt = Date.now();
      const result = { ok: false, exitCode: null, signal: null, durationMs: null, error: err.message };
      const classification = classify({ exitCode: null, signal: null, error: err.message });
      const attempt = (goal.retryCount || 0) + 1;
      _finalize(goal, result, classification, attempt, finishedAt);
      resolve({ ok: false, goal, error: err.message, classification });
    });
  });
}

function _finalize(goal, result, classification, attempt, finishedAt) {
  // auto-retry: transient + 没到 MAX → 重置 pending, retryCount++
  if (classification.retryable && attempt - 1 < MAX_RETRIES) {
    updateGoal(goal.id, {
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      result: { ...result, retriedAfter: attempt },
      classification,
      retryCount: attempt,
    });
    recordRun({
      goalId: goal.id,
      description: goal.description,
      status: 'failed',
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      finishedAt,
      error: result.error || null,
      classification,
      retryAttempt: attempt,
    });
    return { retried: true, attempt, classification };
  }

  // final outcome: done / failed
  const finalStatus = result.ok ? 'done' : 'failed';
  const escalationNeeded = finalStatus === 'failed';

  updateGoal(goal.id, {
    status: finalStatus,
    finishedAt,
    result,
    classification,
    escalatedAt: escalationNeeded ? Date.now() : null,
  });
  recordRun({
    goalId: goal.id,
    description: goal.description,
    status: finalStatus,
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    finishedAt,
    error: result.error || null,
    classification,
    retryAttempt: attempt,
  });

  if (escalationNeeded) {
    escalate(goal, classification, attempt);
  }
  return { retried: false, attempt, classification, escalated: escalationNeeded };
}

export async function runAll(maxRuns = 100) {
  const results = [];
  for (let i = 0; i < maxRuns; i++) {
    const r = await runNext();
    if (!r.ok && r.reason === 'no pending goal') break;
    results.push(r);
  }
  return results;
}
