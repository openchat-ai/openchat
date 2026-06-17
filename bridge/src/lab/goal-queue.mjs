// goal-queue.mjs — 持久化 goal 队列 (P0 / 全自动研发实验室)
//
// 数据: ~/.openchat/lab/queue.jsonl (一行一个 goal, JSON)
// 状态: pending → running → done | failed
// 不变量:
//   - 单文件读写 (假设单用户串行, 不并发)
//   - readAllLines / writeAllLines 配套, write 是全量覆盖
//   - 文件不存在 = 空队列
// 用途:
//   - bin/lab.mjs add/list/status/run-next 调这里
//   - cron/手动 run-next 拉下一个 pending goal, 喂 openchat --goal
//   - housekeeping: recoverStaleRunning + purgePollution (自治, 不靠人清)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { labEvents } from './lab-events.mjs';

const LAB_DIR = join(homedir(), '.openchat', 'lab');
const QUEUE_FILE = join(LAB_DIR, 'queue.jsonl');

function ensureDir() {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
}

function readAllLines() {
  ensureDir();
  if (!existsSync(QUEUE_FILE)) return [];
  const text = readFileSync(QUEUE_FILE, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').map(line => JSON.parse(line));
}

function writeAllLines(goals) {
  ensureDir();
  const text = goals.length > 0
    ? goals.map(g => JSON.stringify(g)).join('\n') + '\n'
    : '';
  writeFileSync(QUEUE_FILE, text, 'utf8');
}

export function addGoal(description, opts = {}) {
  // permanent dedup: 同一描述一旦 done 不再重加
  if (opts.dedup !== false) {
    const existing = readAllLines().find(g => g.description === description);
    if (existing && existing.status === 'done') return existing;
  }
  const goal = {
    id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description,
    addedAt: Date.now(),
    status: 'pending',
    priority: opts.priority || 0,
    startedAt: null,
    finishedAt: null,
    result: null,
    retryCount: 0,
    classification: null,
    escalatedAt: null,
  };
  const lines = readAllLines();
  lines.push(goal);
  writeAllLines(lines);
  labEvents.emit('queue', { type: 'added', goal });
  return goal;
}

export function listGoals(filter = {}) {
  let lines = readAllLines();
  if (filter.status) lines = lines.filter(g => g.status === filter.status);
  if (filter.pending) lines = lines.filter(g => g.status === 'pending');
  return lines;
}

export function getNextPending() {
  const pending = listGoals({ pending: true });
  pending.sort((a, b) => (b.priority - a.priority) || (a.addedAt - b.addedAt));
  return pending[0] || null;
}

export function updateGoal(id, patch) {
  const lines = readAllLines();
  const idx = lines.findIndex(g => g.id === id);
  if (idx === -1) return null;
  lines[idx] = { ...lines[idx], ...patch };
  writeAllLines(lines);
  labEvents.emit('queue', { type: 'updated', goal: lines[idx] });
  return lines[idx];
}

export function removeGoal(id) {
  const lines = readAllLines();
  const idx = lines.findIndex(g => g.id === id);
  if (idx === -1) return null;
  const removed = lines[idx];
  lines.splice(idx, 1);
  writeAllLines(lines);
  labEvents.emit('queue', { type: 'removed', goal: removed });
  return removed;
}

export function getStatus() {
  const all = readAllLines();
  const s = { total: all.length, pending: 0, running: 0, done: 0, failed: 0 };
  for (const g of all) s[g.status] = (s[g.status] || 0) + 1;
  return s;
}

export function listFailed() {
  // P2: 给 failures 命令用
  return readAllLines().filter(g => g.status === 'failed');
}

// === 自治 housekeeping ===

const POLLUTION_PATTERNS = [
  /\bWS (test|broadcast|watcher)\b/i,
  /\bin-process test\b/i,
  /\bTEST_OK_/,
  /\becho (cron|cron-pickup|debug)/i,
  /\bDEBUG_/,
  /\bsmoke( -|_)test/i,
];

/**
 * 检测 description 是不是 debug fixture (pollution)
 * 模式: WS test 类, in-process test, echo/test 调试
 * 返回: { pollution: bool, reason: string|null }
 */
export function detectPollution(description) {
  if (!description) return { pollution: false, reason: null };
  for (const re of POLLUTION_PATTERNS) {
    if (re.test(description)) {
      return { pollution: true, reason: re.source };
    }
  }
  return { pollution: false, reason: null };
}

/**
 * 恢复卡在 running 的 goal (parent 被砍 / 子进程 timeout / SIGKILL 残留)
 * 启发式: status=running 且 startedAt < now - thresholdMs
 * 重置: status=pending, 清 startedAt/finishedAt, retryCount 不重置 (让原有 retry 计数继续生效)
 * 返回: 被恢复的 goal 列表
 */
export function recoverStaleRunning(thresholdMs = 30 * 60 * 1000) {
  const now = Date.now();
  const lines = readAllLines();
  const recovered = [];
  for (let i = 0; i < lines.length; i++) {
    const g = lines[i];
    if (g.status !== 'running') continue;
    if (!g.startedAt) continue;
    if (now - g.startedAt < thresholdMs) continue;
    lines[i] = {
      ...g,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
    };
    recovered.push({ id: g.id, description: g.description, stuckMs: now - g.startedAt });
  }
  if (recovered.length > 0) {
    writeAllLines(lines);
    for (const r of recovered) {
      labEvents.emit('queue', { type: 'updated', goal: lines.find(l => l.id === r.id), recovery: 'stale-running' });
    }
  }
  return recovered;
}

/**
 * 把 pollution goals 标 failed (不再被 runNext pick)
 * 留 queue 里 (历史可查), 但不消耗 cron 时间
 * 返回: 被 purge 的 goal 列表
 */
export function purgePollution() {
  const lines = readAllLines();
  const purged = [];
  for (let i = 0; i < lines.length; i++) {
    const g = lines[i];
    if (g.status === 'done' || g.status === 'failed') continue;  // 不动已结束的
    const det = detectPollution(g.description);
    if (!det.pollution) continue;
    lines[i] = {
      ...g,
      status: 'failed',
      finishedAt: Date.now(),
      classification: { category: 'code', reason: `auto-purged pollution (pattern: ${det.reason})`, retryable: false },
      escalatedAt: null,
    };
    purged.push({ id: g.id, description: g.description, pattern: det.reason });
  }
  if (purged.length > 0) {
    writeAllLines(lines);
    for (const p of purged) {
      labEvents.emit('queue', { type: 'updated', goal: lines.find(l => l.id === p.id), recovery: 'purged-pollution' });
    }
  }
  return purged;
}

/**
 * 一次性 housekeeping: 先恢复 stale running, 再清 pollution
 * 返回: { recovered: [...], purged: [...] }
 */
export function housekeeping(opts = {}) {
  const thresholdMs = opts.thresholdMs ?? 30 * 60 * 1000;
  const skipPurge = opts.skipPurge === true;
  const recovered = recoverStaleRunning(thresholdMs);
  const purged = skipPurge ? [] : purgePollution();
  return { recovered, purged };
}
