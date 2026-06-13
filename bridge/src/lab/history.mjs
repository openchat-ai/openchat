// history.mjs — 每次 run 完成的"日志", append-only, 跟 queue 状态解耦
//
// 跟 queue.jsonl 的区别:
//   - queue.jsonl: 当前 live 状态 (pending/running/done/failed), 可改可覆盖
//   - history.jsonl: 不可变历史, 每行一条 run, 永远只 append
// 数据: {goalId, description, status, exitCode, signal, durationMs, finishedAt, error?}

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const LAB_DIR = join(homedir(), '.openchat', 'lab');
const HISTORY_FILE = join(LAB_DIR, 'history.jsonl');

function ensureDir() {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
}

export function recordRun(run) {
  ensureDir();
  const record = {
    goalId: run.goalId,
    description: run.description,
    status: run.status,
    exitCode: run.exitCode ?? null,
    signal: run.signal ?? null,
    durationMs: run.durationMs ?? null,
    finishedAt: run.finishedAt,
    error: run.error ?? null,
  };
  appendFileSync(HISTORY_FILE, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

export function listHistory(filter = {}) {
  if (!existsSync(HISTORY_FILE)) return [];
  const text = readFileSync(HISTORY_FILE, 'utf8').trim();
  if (!text) return [];
  let lines = text.split('\n').map(line => JSON.parse(line));
  if (filter.since) lines = lines.filter(r => r.finishedAt >= filter.since);
  if (filter.description) lines = lines.filter(r => r.description === filter.description);
  return lines;
}

export function getRunStats() {
  const all = listHistory();
  if (all.length === 0) return { total: 0, success: 0, failed: 0, successRate: null, avgDurationMs: null };
  const success = all.filter(r => r.status === 'done').length;
  const failed = all.filter(r => r.status === 'failed').length;
  const totalDuration = all.reduce((sum, r) => sum + (r.durationMs || 0), 0);
  return {
    total: all.length,
    success,
    failed,
    successRate: success / all.length,
    avgDurationMs: totalDuration / all.length,
  };
}

export function backfillFromQueue() {
  // 把 queue.jsonl 里 status=done|failed 的 goal 一次性 import 到 history
  // 用于 P0 → P1 升级: P0 写的 2 个 done goal 当时还没 history
  const queueFile = join(LAB_DIR, 'queue.jsonl');
  if (!existsSync(queueFile)) return { imported: 0 };
  const text = readFileSync(queueFile, 'utf8').trim();
  if (!text) return { imported: 0 };
  const existing = new Set(listHistory().map(r => r.goalId));
  let imported = 0;
  for (const line of text.split('\n')) {
    const g = JSON.parse(line);
    if (g.status !== 'done' && g.status !== 'failed') continue;
    if (existing.has(g.id)) continue;
    recordRun({
      goalId: g.id,
      description: g.description,
      status: g.status,
      exitCode: g.result?.exitCode ?? null,
      signal: g.result?.signal ?? null,
      durationMs: g.result?.durationMs ?? null,
      finishedAt: g.finishedAt,
      error: g.result?.error ?? null,
    });
    imported++;
  }
  return { imported };
}
