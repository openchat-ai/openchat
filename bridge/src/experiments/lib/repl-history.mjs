// === repl-history.mjs ===
// dev-repl 的消息历史持久化 (opencode `openchat -c` 续接需要)
//
// 存储位置: ~/.openchat/repl-history/<chatId>.json
//   - 与 persistent-store 的 sessions.json 物理隔离
//   - 不参与 sessions 列表 (避免历史会话被时间排序)
//
// 消息格式: [{ role, content, tool_calls?, tool_call_id? }, ...]
//   - OpenAI chat 兼容格式, 可直接塞回 provider.chat() 的 messages 参数
//
// I/O (compose 契约, 供实验 10 dev-aux 测试):
//   { op: 'load', chatId } → { history: [...] }
//   { op: 'save', chatId, history } → { ok, count }
//   { op: 'append', chatId, msg } → { ok, count }
//   { op: 'clear', chatId } → { ok }
//
// === invariants ===
// - load 永不抛 — 文件不存在/JSON 损坏都返回空数组
// - save 原子写: 写 .tmp 再 rename (避免半写状态)
// - 单文件 messages 数组上限 1000 条 (写时裁剪), 防止 history 文件膨胀
// - chatId 路径用 [a-zA-Z0-9_-] 过滤, 防 ../ 穿越
// - 不与 persistent-store 耦合, 是独立 fs 命名空间

import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

const HISTORY_DIR = path.join(homedir(), '.openchat', 'repl-history');
const MAX_HISTORY = 1000;
const VALID_ID = /^[a-zA-Z0-9_-]{1,64}$/;

function safeId(chatId) {
  if (typeof chatId !== 'string' || !VALID_ID.test(chatId)) {
    throw new Error(`repl-history: invalid chatId "${chatId}" (must match ${VALID_ID})`);
  }
  return chatId;
}

function ensureDir() {
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
}

function filePath(chatId) {
  return path.join(HISTORY_DIR, `${safeId(chatId)}.json`);
}

export function loadHistory(chatId) {
  const fp = filePath(chatId);
  try {
    if (!fs.existsSync(fp)) return [];
    const raw = fs.readFileSync(fp, 'utf-8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveHistory(chatId, history) {
  if (!Array.isArray(history)) throw new Error('repl-history: history must be array');
  const fp = filePath(chatId);
  ensureDir();
  // 裁剪
  const trimmed = history.length > MAX_HISTORY
    ? [history[0], ...history.slice(-(MAX_HISTORY - 1))] // 保留 system + 末 N-1
    : history;
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(trimmed));
  fs.renameSync(tmp, fp);
  return { ok: true, count: trimmed.length };
}

export function appendMessage(chatId, msg) {
  const h = loadHistory(chatId);
  h.push(msg);
  return saveHistory(chatId, h);
}

export function clearHistory(chatId) {
  const fp = filePath(chatId);
  try { if (fs.existsSync(fp)) fs.unlinkSync(fp); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

export function listSessions() {
  try {
    ensureDir();
    return fs.readdirSync(HISTORY_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  } catch { return []; }
}

export async function run({ inputs = {} } = {}) {
  const { op, chatId, history, msg } = inputs;
  if (!op) throw new Error('repl-history.run: op required');
  switch (op) {
    case 'load':   return { outputs: { history: loadHistory(chatId) } };
    case 'save':   return { outputs: saveHistory(chatId, history || []) };
    case 'append': return { outputs: appendMessage(chatId, msg) };
    case 'clear':  return { outputs: clearHistory(chatId) };
    case 'list':   return { outputs: { sessions: listSessions() } };
    default: throw new Error(`repl-history.run: unknown op "${op}"`);
  }
}

export const META = { id: 'repl-history' };
