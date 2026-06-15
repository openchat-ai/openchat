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
// - [turbo] pure:true 实验直接 in-process import + test()，跳过子进程

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { getNextPending, updateGoal, housekeeping } from './goal-queue.mjs';
import { recordRun } from './history.mjs';
import { classify } from './failure-analyzer.mjs';
import { escalate } from './escalate.mjs';
import { labEvents } from './lab-events.mjs';
import { addFact } from '../experiments/lib/agent-memory.mjs';
import { registerRun, unregisterRun, appendOutput } from './active-runs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENCHAT_BIN = join(__dirname, '..', '..', 'bin', 'openchat.mjs');
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

let _manifestPromise = null;
async function _getManifest() {
  if (_manifestPromise) return _manifestPromise;
  _manifestPromise = (async () => {
    try {
      const fs = await import('fs');
      const p = resolve(__dirname, '../experiments/manifest.json');
      if (!fs.existsSync(p)) return null;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { return null; }
  })();
  return _manifestPromise;
}

async function _isPureGoal(description) {
  const manifest = await _getManifest();
  if (!manifest) return false;
  const m = description.match(/实验\s+(\S+):/);
  if (!m) return false;
  const file = m[1];
  const exp = manifest.experiments.find(e => e.file === file + '.mjs' || e.file === file);
  return exp?.pure === true;
}

export async function runNext(turbo = false) {
  // 自治 housekeeping: 卡 running 太久 → 重置 pending; pollution → 标 failed
  // 任何 runNext (manual / cron / bench) 都先 self-clean
  _housekeep();
  // 确保 supervisor 已启动（fire-and-forget）
  _ensureSupervisor();
  const goal = getNextPending();
  if (!goal) return { ok: false, reason: 'no pending goal' };

  // [turbo] pure 实验 in-process 直接跑, 跳过子进程
  if (turbo && await _isPureGoal(goal.description)) {
    return await _runTurbo(goal);
  }

  const startedAt = Date.now();
  updateGoal(goal.id, { status: 'running', startedAt });
  labEvents.emit('runner', { type: 'start', goalId: goal.id, description: goal.description, startedAt });

  return new Promise((resolve) => {
    const child = spawn('node', [OPENCHAT_BIN, '--goal', goal.description], {
      cwd: process.cwd(),
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    // 捕获 stdout 供 supervisor 分析
    const runReg = registerRun(goal.id, { child, description: goal.description });
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        process.stdout.write(chunk); // 还是输出到终端
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.trim()) appendOutput(goal.id, line);
        }
      });
    }

    child.on('exit', (code, signal) => {
      unregisterRun(goal.id);
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
      unregisterRun(goal.id);
      const finishedAt = Date.now();
      const result = { ok: false, exitCode: null, signal: null, durationMs: null, error: err.message };
      const classification = classify({ exitCode: null, signal: null, error: err.message });
      const attempt = (goal.retryCount || 0) + 1;
      _finalize(goal, result, classification, attempt, finishedAt);
      resolve({ ok: false, goal, error: err.message, classification });
    });
  });
}

async function _runTurbo(goal) {
  const startedAt = Date.now();
  updateGoal(goal.id, { status: 'running', startedAt });
  labEvents.emit('runner', { type: 'start', goalId: goal.id, description: goal.description, startedAt });

  // 可取消包装
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  registerRun(goal.id, { description: goal.description, cancel });
  try {
    const m = goal.description.match(/实验\s+(\S+):/);
    const file = m ? `${m[1]}` : null;
    const experimentsDir = resolve(__dirname, '../experiments');
    let mod;
    if (file && file.includes('/')) mod = await import(resolve(experimentsDir, file));
    else if (file) mod = await import(resolve(experimentsDir, file + '.mjs'));
    else mod = null;
    const testFn = mod && (typeof mod.test === 'function' ? mod.test : null);
    if (!testFn) throw new Error(`no test() in ${file}`);
    // 可取消：与 cancel promise race
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

  // 写入 agent memory (fire-and-forget)
  addFact(`实验 ${goal.description.slice(0, 40)} → ${finalStatus} (${(result.durationMs / 1000).toFixed(1)}s)`).catch(() => {});

  if (escalationNeeded) {
    escalate(goal, classification, attempt);
  }
  return { retried: false, attempt, classification, escalated: escalationNeeded };
}

// === 自治 housekeeping ===
// 每次 runNext 入口调一次, 防止上一次 (parent 被砍 / 子进程 timeout / SIGKILL)
// 把 goal 留在 running 状态. 也清 WS test 之类的 pollution.
// 默认 30min threshold — 留出长 LLM 调用余量.
let _lastHousekeepAt = 0;
const _HOUSEKEEP_INTERVAL_MS = 60 * 1000;  // 1 分钟内不重复 (multi-goal cycle)
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
