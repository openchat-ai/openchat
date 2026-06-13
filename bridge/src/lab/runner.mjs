// runner.mjs — 拉下一个 pending goal, 跳 openchat --goal, 写 result
//
// 流程:
//   1. getNextPending() → 拿优先级最高的 pending
//   2. 标 running, 记 startedAt
//   3. spawn `node bin/openchat.mjs --goal <desc>`  (子进程直连 provider, 不占桥端口)
//   4. 子进程 exit → 标 done/failed, 记 finishedAt + result
//
// 不变量:
//   - 单 goal 串行跑 (不并发), lab 假设单用户
//   - 子进程 stdio: 'inherit' → 跑 goal 时用户能看见 /goal 的输出
//   - exit code 0 = done, 其它 = failed

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getNextPending, updateGoal } from './goal-queue.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPENCHAT_BIN = join(__dirname, '..', '..', 'bin', 'openchat.mjs');

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
      updateGoal(goal.id, {
        status: code === 0 ? 'done' : 'failed',
        finishedAt,
        result,
      });
      resolve({ ok: true, goal, result });
    });

    child.on('error', (err) => {
      updateGoal(goal.id, {
        status: 'failed',
        finishedAt: Date.now(),
        result: { ok: false, error: err.message },
      });
      resolve({ ok: false, goal, error: err.message });
    });
  });
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
