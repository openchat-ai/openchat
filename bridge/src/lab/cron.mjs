// cron.mjs — 定时拉 runNext, 真正"无人值守"
//
// 用法:
//   import { startCron, stopCron, isCronRunning } from './cron.mjs';
//   const handle = startCron({ intervalMs: 30*60*1000 });
//   process.on('SIGINT', handle.stop);
//
// 设计:
//   - 启动: 写 pidfile (~/.openchat/lab/cron.pid), 拒绝双开
//   - 启动后: 等 intervalMs (默认 30 min), 然后跑一轮, 跑完再 wait
//   - 一轮: 连续 runNext 直到 no-pending (队列空就跳出, 避免每 30min 都跑空)
//   - 退出: SIGINT/SIGTERM handler → stop() → 清 pidfile
//   - 错误: 单次 runNext throw 不 kill 循环, 记到 console (lab 主流程已 classify, 不太会 throw)
//   - 不动 queue 状态: 跟单次 run-next 行为一致
//
// 跟 run-all 的区别:
//   - run-all: 一次性 drain 到空, 退出
//   - run-cron: 永远不退出, 每 interval 触发新 drain

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { runNext } from './runner.mjs';

const LAB_DIR = join(homedir(), '.openchat', 'lab');
const PID_FILE = join(LAB_DIR, 'cron.pid');

function ensureDir() {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
}

function _readPid() {
  if (!existsSync(PID_FILE)) return null;
  try {
    const text = readFileSync(PID_FILE, 'utf8').trim();
    return text ? parseInt(text, 10) : null;
  } catch { return null; }
}

function _writePid(pid) {
  ensureDir();
  writeFileSync(PID_FILE, String(pid), 'utf8');
}

function _clearPid() {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
}

function _pidAlive(pid) {
  if (!pid) return false;
  try {
    // signal 0 不真发信号, 只检查能不能发 — 能发就是活进程
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';  // EPERM = 进程存在, 只是没权限 kill
  }
}

export function isCronRunning() {
  const pid = _readPid();
  if (!pid) return false;
  if (!_pidAlive(pid)) {
    // 死 pidfile, 清掉
    _clearPid();
    return false;
  }
  return pid === process.pid || true;  // 自己或别的进程都算 running
}

export function getCronPid() {
  return _readPid();
}

export function startCron(opts = {}) {
  const intervalMs = opts.intervalMs
    ?? (process.env.OPENCHAT_LAB_CRON_INTERVAL
          ? parseInt(process.env.OPENCHAT_LAB_CRON_INTERVAL, 10)
          : 30 * 60 * 1000);

  // 防双开
  const existing = _readPid();
  if (existing && _pidAlive(existing) && existing !== process.pid) {
    return { ok: false, reason: 'cron already running', pid: existing };
  }
  _writePid(process.pid);

  let stopped = false;
  let cycleCount = 0;
  let runCount = 0;
  let lastRunAt = null;
  let lastError = null;

  const log = (msg) => console.log(`[cron] ${new Date().toISOString()} ${msg}`);

  log(`started (pid=${process.pid}, interval=${(intervalMs/1000).toFixed(0)}s)`);

  const stop = (reason = 'manual') => {
    if (stopped) return;
    stopped = true;
    log(`stopping (reason: ${reason}, cycles=${cycleCount}, runs=${runCount})`);
    _clearPid();
    // 退出进程 — setTimeout 链 / lab-events watcher 都会 keep-alive
    // 不显式 exit 永远停不下来
    setImmediate(() => process.exit(0));
  };

  const cycle = async () => {
    if (stopped) return;
    cycleCount++;
    const cycleStart = Date.now();
    log(`cycle #${cycleCount} start`);

    // 连续跑直到队列空
    let cycleRuns = 0;
    while (!stopped) {
      let r;
      try {
        r = await runNext();
      } catch (e) {
        lastError = e.message;
        log(`cycle #${cycleCount} error: ${e.message}`);
        break;
      }
      if (!r.ok && r.reason === 'no pending goal') {
        break;
      }
      cycleRuns++;
      runCount++;
      lastRunAt = Date.now();
      const sec = (r.result?.durationMs / 1000).toFixed(1);
      const st = r.result?.ok ? 'OK' : 'FAIL';
      log(`cycle #${cycleCount} run ${cycleRuns}: ${r.goal.id} ${st} (${sec}s)`);
    }

    const dur = ((Date.now() - cycleStart) / 1000).toFixed(1);
    log(`cycle #${cycleCount} done (ran ${cycleRuns} goal(s), ${dur}s)`);

    // schedule next
    if (!stopped) {
      setTimeout(cycle, intervalMs);
    }
  };

  // schedule first cycle
  setTimeout(cycle, intervalMs);

  // 监控 pidfile: 没了就自己退出
  // 原因: Windows 上 SIGINT 不可靠, lab.mjs cron-stop 删 pidfile
  // cron 1s 内看到 pidfile 不见了 → stop()
  const watcher = setInterval(() => {
    if (!_readPid()) {
      stop('pidfile missing');
      clearInterval(watcher);
    }
  }, 1000);

  // register signal handlers (only if not already registered by caller)
  const onSig = (sig) => stop(sig);
  process.once('SIGINT', () => onSig('SIGINT'));
  process.once('SIGTERM', () => onSig('SIGTERM'));

  return {
    ok: true,
    pid: process.pid,
    intervalMs,
    stop,
    getStatus: () => ({
      pid: process.pid,
      intervalMs,
      stopped,
      cycleCount,
      runCount,
      lastRunAt,
      lastError,
    }),
  };
}

export function stopCron() {
  const pid = _readPid();
  if (!pid) return { ok: false, reason: 'no cron running' };
  if (!_pidAlive(pid)) {
    _clearPid();
    return { ok: false, reason: 'stale pidfile cleaned' };
  }
  if (pid === process.pid) {
    return { ok: false, reason: 'cannot stop self, send SIGINT to the cron process' };
  }
  // 双保险: 删 pidfile (cron 1s 内看到会自己 exit)
  // + 发 SIGINT (Linux 上 cron 立即 exit, 不需要 pidfile poll)
  // 顺序: 先删 pidfile — 万一 SIGINT 在 Windows 上无效, poll 还能 catch
  let killed = false;
  let killError = null;
  try {
    process.kill(pid, 'SIGINT');
    killed = true;
  } catch (e) {
    killError = e.message;
  }
  _clearPid();
  return {
    ok: true,
    stopped: pid,
    signaled: killed,
    killError,
  };
}