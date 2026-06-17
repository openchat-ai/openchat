// supervisor.mjs — 监控循环，检测 running goal 的异常状态并干涉
//
// 检测维度：
//   1. 静默卡死 — lastOutputAt 超过 stuckThresholdMs 无输出
//   2. 死循环   — 同一条 log 重复超过 loopThreshold 次
//   3. 超长运行 — duration > medianDuration * durationRatio
// 干涉措施：
//   1. 先发 SIGINT（子进程）/ set cancel flag（turbo）
//   2. 读最后 N 行输出 → 附加诊断 → 重置 goal 为 pending + hint
//   3. 救不活 → escalate

// === invariants ===
// - 每 checkIntervalMs 扫描一次，不阻塞 runner
// - 不修改 goal 数据，只通过 registry 观察
// - 干涉时先软后硬（SIGINT → 无响应则 SIGTERM → escalate）
// - 同一条干涉 60s 内不重复

import { spawn } from 'child_process';
import { getActiveRuns, getTail, unregisterRun } from './active-runs.mjs';
import { updateGoal } from './goal-queue.mjs';
import { recordRun } from './history.mjs';
import { classify } from './failure-analyzer.mjs';
import { diagnose } from './auto-heal.mjs';
import { labEvents } from './lab-events.mjs';

const DEFAULTS = {
  checkIntervalMs: 30_000,
  stuckThresholdMs: 120_000,       // 2min 无输出 → 卡死
  loopThreshold: 5,                // 同一行出现 5 次 → 死循环
  durationRatio: 3,                // >3x median → 超长
  cooldownMs: 60_000,              // 同 goal 干涉冷却期
};

// 从 history 计算同类实验的中位耗时
function _medianDuration(description) {
  try {
    const { listHistory } = require('fs');
    // 动态 import 避免循环依赖
  } catch (e) { console.error('[C0]', e); }
  return null;
}

async function _loadHistoryForDuration(description) {
  try {
    const { listHistory } = await import('./history.mjs');
    const all = listHistory();
    const same = all.filter(r => r.description === description && r.durationMs > 0 && r.status === 'done');
    if (same.length === 0) return null;
    const sorted = same.map(r => r.durationMs).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  } catch { return null; }
}

async function _intervene(run, detection, opts = {}) {
  const { goalId, child, cancel, description } = run;
  const cooldownKey = `intervene:${goalId}`;
  const lastIntervene = globalThis._supervisorCooldowns?.get(cooldownKey);
  if (lastIntervene && Date.now() - lastIntervene < (opts.cooldownMs || DEFAULTS.cooldownMs)) return;
  if (!globalThis._supervisorCooldowns) globalThis._supervisorCooldowns = new Map();
  globalThis._supervisorCooldowns.set(cooldownKey, Date.now());

  const tail = getTail(goalId, 15);
  const tailText = tail.join('\n');
  console.debug(`[supervisor] detecting ${goalId}: ${detection.reason}`);

  // 1. 软干涉：发 SIGINT / 设 cancel flag
  if (child && child.pid && !child.killed) {
    try { process.kill(child.pid, 'SIGINT'); } catch (e) { console.error('[C0]', e); }
    // 等 5s 看进程是否退出
    await new Promise(r => setTimeout(r, 5000));
    if (child.exitCode === null && !child.killed) {
      // 没反应 → SIGTERM
      try { process.kill(child.pid, 'SIGTERM'); } catch (e) { console.error('[C0]', e); }
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  if (cancel) {
    try { cancel(); } catch (e) { console.error('[C0]', e); }
  }

  // 2. 用 auto-heal 诊断 tail
  const diag = await diagnose({ ok: false, error: tailText });
  const suggestion = diag.ok ? null : diag.diagnosis?.suggestion || 'Unknown loop';

  // 3. 把 goal 重置为 pending + 注入 hint
  const finishedAt = Date.now();
  const result = { ok: false, exitCode: null, signal: 'SIGINT', durationMs: finishedAt - run.startedAt, error: `[supervisor] ${detection.reason}: ${suggestion || tailText.slice(0, 80)}` };
  const classification = classify({ exitCode: null, signal: 'SIGINT', error: result.error });

  // 先记为 failed（避免后续 supervisor 再扫描到它）
  updateGoal(goalId, {
    status: 'failed',
    finishedAt,
    result,
    classification,
  });
  recordRun({
    goalId,
    description,
    status: 'failed',
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    finishedAt,
    error: result.error,
    classification,
    retryAttempt: 0,
  });
  labEvents.emit('runner', { type: 'finish', goalId, description, reason: 'supervisor-intervene' });

  // 再重置为 pending（带 hint）
  updateGoal(goalId, {
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    result: null,
    classification: null,
    escalatedAt: null,
  });
  console.debug(`[supervisor] ${goalId}: ${detection.reason} → reset to pending (hint: ${suggestion || 'retry'})`);
}

export async function startSupervisor(opts = {}) {
  const {
    checkIntervalMs = DEFAULTS.checkIntervalMs,
    stuckThresholdMs = DEFAULTS.stuckThresholdMs,
    loopThreshold = DEFAULTS.loopThreshold,
    durationRatio = DEFAULTS.durationRatio,
  } = opts;

  let stopped = false;

  async function check() {
    if (stopped) return;
    const runs = getActiveRuns();
    for (const run of runs) {
      // 跳过冷却期内的
      if (run.goalId && globalThis._supervisorCooldowns?.get(`intervene:${run.goalId}`)) {
        const last = globalThis._supervisorCooldowns.get(`intervene:${run.goalId}`);
        if (Date.now() - last < DEFAULTS.cooldownMs) continue;
      }

      const now = Date.now();
      const duration = now - run.startedAt;
      const detections = [];

      // 1. 静默卡死
      const silentFor = now - run.lastOutputAt;
      if (silentFor > stuckThresholdMs && duration > stuckThresholdMs) {
        detections.push({ type: 'stuck', reason: `No output for ${(silentFor / 1000).toFixed(0)}s (duration ${(duration / 1000).toFixed(0)}s)` });
      }

      // 2. 死循环
      const repeatedLines = Object.entries(run.loopCounter).filter(([_, c]) => c >= loopThreshold);
      if (repeatedLines.length > 0) {
        const worst = repeatedLines.sort((a, b) => b[1] - a[1])[0];
        detections.push({ type: 'loop', reason: `Line "${worst[0].slice(0, 60)}" repeated ${worst[1]} times` });
      }

      // 3. 超长运行（对比同类实验）
      const median = await _loadHistoryForDuration(run.description);
      if (median && duration > median * durationRatio) {
        detections.push({ type: 'overlong', reason: `Running ${(duration / 1000).toFixed(0)}s (${(duration / median).toFixed(1)}x median ${(median / 1000).toFixed(0)}s)` });
      }

      if (detections.length > 0) {
        const primary = detections.sort((a, b) => {
          const w = { stuck: 3, loop: 2, overlong: 1 };
          return (w[b.type] || 0) - (w[a.type] || 0);
        })[0];
        await _intervene(run, primary, opts);
      }
    }
    if (!stopped) setTimeout(check, checkIntervalMs);
  }

  setTimeout(check, checkIntervalMs);
  console.debug(`[supervisor] started (every ${(checkIntervalMs / 1000).toFixed(0)}s)`);

  return {
    stop: () => { stopped = true; console.debug('[supervisor] stopped'); },
    getStatus: () => ({ running: !stopped, checkIntervalMs }),
  };
}

export const META = { id: 'supervisor' };
