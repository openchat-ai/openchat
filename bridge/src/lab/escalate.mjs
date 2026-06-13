// escalate.mjs — 把真挂的目标 (非 transient / 超过 retry 上限) 写到 escalated log
//
// 数据: ~/.openchat/lab/escalated.jsonl (append-only, 跟 history 一样不可变)
// 触发:
//   - runner.mjs: 跑完一 goal, 分类为 code/config/unknown OR 超过 MAX_RETRIES 的 transient
//   - 直接 escalate(goal, classification, attempts)
//
// L3: 写完 log 后, fire-and-forget 调 notifier — user 配置了 OPENCHAT_LAB_NOTIFY 就发推送
// 不覆盖 goal-queue 的 status (还是 done/failed), 只额外写一份 escalated 记录

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { notifyFireAndForget } from './notifier.mjs';

const LAB_DIR = join(homedir(), '.openchat', 'lab');
const ESCALATED_FILE = join(LAB_DIR, 'escalated.jsonl');

function ensureDir() {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
}

export function escalate(goal, classification, attempts) {
  ensureDir();
  const record = {
    goalId: goal.id,
    description: goal.description,
    classification,  // {category, reason, retryable}
    attempts,        // 实际跑了几次 (1 = 一次就挂, 2 = 一次 retry 后挂, 3 = max retry 后挂)
    escalatedAt: Date.now(),
  };
  appendFileSync(ESCALATED_FILE, JSON.stringify(record) + '\n', 'utf8');
  // L3: fire-and-forget 通知, 不阻塞主流程
  notifyFireAndForget(record);
  return record;
}

export function listEscalated() {
  if (!existsSync(ESCALATED_FILE)) return [];
  const text = readFileSync(ESCALATED_FILE, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').map(line => JSON.parse(line));
}

export function getEscalationStats() {
  const all = listEscalated();
  if (all.length === 0) return { total: 0, byCategory: {}, byDescription: [] };

  const byCategory = {};
  const byDescriptionMap = new Map();
  for (const r of all) {
    const cat = r.classification?.category || 'unknown';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    if (!byDescriptionMap.has(r.description)) byDescriptionMap.set(r.description, 0);
    byDescriptionMap.set(r.description, byDescriptionMap.get(r.description) + 1);
  }

  const byDescription = [...byDescriptionMap.entries()]
    .map(([description, count]) => ({ description, count }))
    .sort((a, b) => b.count - a.count);

  return { total: all.length, byCategory, byDescription };
}
