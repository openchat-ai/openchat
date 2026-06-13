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
  const goal = {
    id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description,
    addedAt: Date.now(),
    status: 'pending',
    priority: opts.priority || 0,
    startedAt: null,
    finishedAt: null,
    result: null,
    retryCount: 0,            // P2: auto-retry 计数器
    classification: null,      // P2: failure-analyzer 输出
    escalatedAt: null,         // P2: 何时被 escalate
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
