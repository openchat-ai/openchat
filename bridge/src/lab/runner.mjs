// runner.mjs — 拉下一个 pending goal, 直接 in-process 跑 test(), 写 result
//
// 流程:
//   1. getNextPending() → 拿优先级最高的 pending
//   2. 标 running, 记 startedAt
//   3. 解析 goal description → 找到对应实验文件 → import + test()
//   4. test() 返回 → classify(runResult) →
//      - success → done
//      - transient + retryCount < MAX → 重置 pending, retryCount++
//      - 其它 (code/config/unknown) → failed + escalate
//      - transient 但 retryCount >= MAX → failed + escalate
//   5. 所有实验一律 in-process (turbo), 不走子进程

// === invariants ===
// - 单 goal 串行跑 (不并发), lab 假设单用户
// - 所有实验 in-process, 无子进程开销
// - test() 抛错或返回 { ok: false } 都算 fail
// - 可取消: supervisor 设 cancel flag, 500ms polling 检测
// - exit code 0 = success, 非 0 = code
// - MAX_RETRIES 默认 2 (共 3 次尝试)
// - 失败 escalate 是 fire-and-forget, 不等返回

import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join, resolve } from 'path';
import { getNextPending, updateGoal, housekeeping } from './goal-queue.mjs';
import { recordRun } from './history.mjs';
import { classify } from './failure-analyzer.mjs';
import { escalate } from './escalate.mjs';
import { labEvents } from './lab-events.mjs';
import { addFact } from '../experiments/lib/agent-memory.mjs';
import { registerRun, unregisterRun } from './active-runs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXP_DIR = resolve(__dirname, '../experiments');
const MAX_RETRIES = 2;

// 自动启动 supervisor（只一次）
let _supervisorStarted = false;
async function _ensureSupervisor() {
  if (_supervisorStarted) return;
  _supervisorStarted = true;
  try {
    const { startSupervisor } = await import('./supervisor.mjs');
    const h = await startSupervisor();
    globalThis._supervisorHandle = h;
  } catch (e) {
    console.error(`[runner] supervisor start failed: ${e.message}`);
  }
}

export async function runNext(turbo = true) {
  // 自治 housekeeping: 卡 running 太久 → 重置 pending; pollution → 标 failed
  _housekeep();
  // 确保 supervisor 已启动
  _ensureSupervisor();
  const goal = getNextPending();
  if (!goal) return { ok: false, reason: 'no pending goal' };

  return await _runTurbo(goal);
}

async function _runTurbo(goal) {
  const startedAt = Date.now();
  updateGoal(goal.id, { status: 'running', startedAt });
  labEvents.emit('runner', { type: 'start', goalId: goal.id, description: goal.description, startedAt });

  let cancelled = false;
  const cancel = () => { cancelled = true; };
  registerRun(goal.id, { description: goal.description, cancel });

  try {
    const m = goal.description.match(/实验\s+(\S+):/);
    const file = m ? m[1] : null;
    let mod;
    if (file && file.includes('/')) mod = await import(pathToFileURL(resolve(EXP_DIR, file)));
    else if (file) mod = await import(pathToFileURL(resolve(EXP_DIR, file + '.mjs')));
    else mod = null;
    const testFn = mod && (typeof mod.test === 'function' ? mod.test : null);
    if (!testFn) throw new Error(`no test() in ${file || goal.description}`);

    const cancelPromise = new Promise((_, reject) => {
      const iv = setInterval(() => { if (cancelled) { clearInterval(iv); reject(new Error('cancelled by supervisor')); } }, 500);
    });
    const testResult = await Promise.race([testFn(), cancelPromise]);
    const finishedAt = Date.now();
    const result = { ok: testResult?.ok !== false, exitCode: 0, signal: null, durationMs: finishedAt - startedAt };
    const classification = classify({ exitCode: 0 });
    const attempt = (goal.retryCount || 0) + 1;
    unregisterRun(goal.id);
    _finalize(goal, result, classification, attempt, finishedAt);
    return { ok: true, goal, result, classification };
  } catch (e) {
    const finishedAt = Date.now();
    const result = { ok: false, exitCode: null, signal: null, durationMs: finishedAt - startedAt, error: e.message };
    const classification = classify({ exitCode: null, signal: null, error: e.message });
    const attempt = (goal.retryCount || 0) + 1;
    unregisterRun(goal.id);
    _finalize(goal, result, classification, attempt, finishedAt);
    return { ok: false, goal, error: e.message, classification };
  }
}

function _finalize(goal, result, classification, attempt, finishedAt) {
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

  addFact(`实验 ${goal.description.slice(0, 40)} → ${finalStatus} (${(result.durationMs / 1000).toFixed(1)}s)`).catch(() => {});

  if (escalationNeeded) {
    escalate(goal, classification, attempt);
  }
  return { retried: false, attempt, classification, escalated: escalationNeeded };
}

// === 自治 housekeeping ===
let _lastHousekeepAt = 0;
const _HOUSEKEEP_INTERVAL_MS = 60 * 1000;
function _housekeep() {
  const now = Date.now();
  if (now - _lastHousekeepAt < _HOUSEKEEP_INTERVAL_MS) return;
  _lastHousekeepAt = now;
  const r = housekeeping();
  if (r.recovered.length > 0) {
    console.log(`[runner] housekeeping: recovered ${r.recovered.length} stale running goal(s)`);
    for (const x of r.recovered) {
      console.log(`[runner]   reset ${x.id} (stuck ${(x.stuckMs/1000/60).toFixed(0)} min): ${x.description.slice(0, 50)}`);
    }
  }
  if (r.purged.length > 0) {
    console.log(`[runner] housekeeping: purged ${r.purged.length} pollution goal(s)`);
    for (const x of r.purged) {
      console.log(`[runner]   marked failed ${x.id} (pattern: ${x.pattern}): ${x.description.slice(0, 50)}`);
    }
  }
}

export async function runAll(maxRuns = 100, turbo = true) {
  const results = [];
  for (let i = 0; i < maxRuns; i++) {
    const r = await runNext(turbo);
    if (!r.ok && r.reason === 'no pending goal') break;
    results.push(r);
  }
  return results;
}
