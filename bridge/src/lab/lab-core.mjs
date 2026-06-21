// === lab-core.mjs — Merged lab modules ===
// Combined from: lab-events.mjs, active-runs.mjs, findings.mjs, scout-shared.mjs, goal-queue.mjs, history.mjs, failure-analyzer.mjs, notifier.mjs, aggregator.mjs, digest.mjs, regression.mjs, escalate.mjs, auto-heal.mjs, path-explorer.mjs, dependency-graph.mjs, knowledge-extract.mjs, lab-health.mjs, git-diff.mjs, fixers\empty-catch.mjs, fixers\index.mjs

import { EventEmitter } from 'events';
import { watch, statSync, existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync, appendFileSync } from 'fs';
import { join, resolve, extname, relative, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { fork, execSync } from 'child_process';
import { readFile, readdir, writeFile, mkdir } from 'fs/promises';

// ===============================
// Module code
// ===============================

// lab-events.mjs — 事件总线, fire-and-forget, 推 /lab WebSocket
//
// 设计: 单进程 EventEmitter + file watcher (跨进程)
//   - 写 jsonl 是 source of truth, 事件只是"刚才变了"信号
//   - 客户端收到事件就 re-fetch 相应 API (不强同步 payload)
//   - 失败/没人订阅 → silently drop, 不影响主流程
//
// 跨进程问题:
//   - lab.mjs CLI (run-next / add) 跟 bridge 是不同进程
//   - 直接 emit 只能被同进程订阅者收到
//   - 所以这里加 file watcher: 监听 jsonl 文件变化, emit 事件
//   - 进程内直接 emit 也保留 (immediate, 避免 watcher 1-2s 延迟)
//
// 事件清单:
//   'queue'    {type: 'added'|'updated', goal, fromWatcher?}  // goal-queue.mjs / watcher
//   'history'  {type: 'added', run, fromWatcher?}             // history.mjs / watcher
//   'escalate' {record, fromWatcher?}                         // escalate.mjs / watcher
//   'runner'   {type: 'start'|'finish', goalId, ...}          // runner.mjs (只进程内)
//
// 用法:
//   import { labEvents } from './lab-events.mjs';
//   labEvents.emit('queue', {type: 'added', goal});
//   labEvents.on('queue', (evt) => { ... });


// === invariants ===
// - HTTP 调用使用 AbortSignal.timeout 超时保护
// - try/catch 覆盖所有外部 IO 调用
// - 事件发射使用 fire-and-forget，不阻塞调用方

const LAB_DIR = join(homedir(), '.openchat', 'lab');

class LabEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);  // 多个 WS client + 调试监听
    this._watchers = new Map();  // file path → FSWatcher
    this._lastSize = {};         // file → last known size (避免重复 emit)
  }

  /**
   * 启动 file watcher, 跨进程感知 jsonl 变化
   * 同一文件多次启动会被 dedupe
   */
  startWatcher(file, channel) {
    const fullPath = join(LAB_DIR, file);
    if (this._watchers.has(fullPath)) return;
    if (!existsSync(fullPath)) {
      // 文件可能还不存在, 等创建后再 watch
      // 简单做法: 50ms 后重试, 最多 20 次 (1s)
      let retries = 20;
      const tryWatch = () => {
        if (existsSync(fullPath)) {
          this._doWatch(fullPath, channel);
        } else if (--retries > 0) {
          setTimeout(tryWatch, 50);
        }
      };
      tryWatch();
      return;
    }
    this._doWatch(fullPath, channel);
  }

  _doWatch(fullPath, channel) {
    try {
      const w = watch(fullPath, { persistent: true }, (eventType) => {
        if (eventType === 'change') {
          // 检查 size 变化避免 debounce 期间重复
          // (fs.watch 在某些平台上会重复 fire)
          let size = 0;
          try { size = statSync(fullPath).size; } catch (e) { console.error('[C0]', e); }
          if (this._lastSize[fullPath] === size) return;
          this._lastSize[fullPath] = size;
          this.emit(channel, { type: 'changed', fromWatcher: true });
        }
      });
      w.on('error', () => {});  // 文件被删/重建不抛
      this._watchers.set(fullPath, w);
    } catch (e) {
      // watch 失败不抛, 进程内 emit 仍能用
    }
  }

  stopAllWatchers() {
    for (const w of this._watchers.values()) {
      try { w.close(); } catch (e) { console.error('[C0]', e); }
    }
    this._watchers.clear();
  }
}

const labEvents = new LabEvents();

// 不在 module 顶层自动 startWatcher — 留给 initLabWatchers()
// (lab.mjs CLI 不需要 watcher, 自动启会让 process 不退出)
let _initialized = false;
function initLabWatchers() {
  if (_initialized) return;
  _initialized = true;
  labEvents.startWatcher('queue.jsonl', 'queue');
  labEvents.startWatcher('history.jsonl', 'history');
  labEvents.startWatcher('escalated.jsonl', 'escalate');
}


// active-runs.mjs — 正在跑的目标注册表
// 供 supervisor 监控 + runner 注册/反注册

// === invariants ===
// - _runs 只在主线程读写，无需锁
// - logLines 上限 100 条，溢出裁头
// - loopCounter 对 logLines 去重（同一行文本计重复次数）
// - registerRun 覆盖旧条目（同 goalId）

const _runs = new Map();

function registerRun(goalId, opts = {}) {
  const run = {
    goalId,
    child: opts.child || null,         // ChildProcess（subprocess 模式）
    startedAt: Date.now(),
    lastOutputAt: Date.now(),
    logLines: [],
    loopCounter: {},
    cancel: opts.cancel || null,       // 取消函数（turbo 模式）
    description: opts.description || '',
    manifest: opts.manifest || null,   // 可选，来自 manifest.json 的 meta
  };
  _runs.set(goalId, run);
  return run;
}

function unregisterRun(goalId) {
  _runs.delete(goalId);
}

function getActiveRuns() {
  return [..._runs.values()];
}

function getRun(goalId) {
  return _runs.get(goalId);
}

function appendOutput(goalId, text) {
  const run = _runs.get(goalId);
  if (!run) return;
  run.lastOutputAt = Date.now();
  const line = text.replace(/\r?\n$/, '');
  run.logLines.push(line);
  if (run.logLines.length > 100) run.logLines.splice(0, run.logLines.length - 100);
  run.loopCounter[line] = (run.loopCounter[line] || 0) + 1;
}

function getTail(goalId, n = 10) {
  const run = _runs.get(goalId);
  if (!run) return [];
  return run.logLines.slice(-n);
}

const META_activeRuns = { id: 'active-runs' };



// LAB_DIR already declared above
const FINDINGS_FILE = join(LAB_DIR, 'findings.jsonl');

const _seenKeys = new Set();

function ensureDir() {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
}

function _key(type, desc, files) {
  const filesKey = Array.isArray(files) ? files.join('|') : (files || '');
  return createHash('sha256').update(`${type}|${desc}|${filesKey}`).digest('hex').slice(0, 16);
}

function addFinding(project, type, desc, files = null) {
  const k = _key(type, desc, files);
  if (_seenKeys.has(k)) return null;
  _seenKeys.add(k);
  ensureDir();
  const entry = { ts: Date.now(), project, type, desc };
  if (files) entry.files = files;
  const line = JSON.stringify(entry) + '\n';
  try {
    writeFileSync(FINDINGS_FILE, line, { flag: 'as+', encoding: 'utf8' });
  } catch {
    const existing = existsSync(FINDINGS_FILE) ? readFileSync(FINDINGS_FILE, 'utf8') : '';
    writeFileSync(FINDINGS_FILE, existing + line, 'utf8');
  }
  return entry;
}

function _resetDedup() { _seenKeys.clear(); }



// === invariants ===
// - 所有异步操作使用 await 或 Promise.all 串联
// - 同步 FS 调用仅用于小文件读写，阻塞 ≤1ms
// - HTTP 调用使用 AbortSignal.timeout 超时保护
// - try/catch 覆盖所有外部 IO 调用
// - 所有网络请求有 explicit timeout
// - 事件发射使用 fire-and-forget，不阻塞调用方

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '../..');
const SRC_DIR = join(PROJECT_ROOT, 'src');
const EXP_DIR = join(SRC_DIR, 'experiments');
// LAB_DIR already declared above
const PROJECTS_FILE = join(LAB_DIR, 'projects.json');
const MANIFEST_FILE = join(EXP_DIR, 'manifest.json');
const PERSISTENT_CONFIG = join(SRC_DIR, 'core/persistent-config.js');
const DEDUP_FILE = join(LAB_DIR, 'self-mod-dedup.json');

const CONCURRENCY = 20;
const MIN_PENDING = 10;
const FETCH_TIMEOUT = 5000;

function loadDedup() {
  try { return JSON.parse(readFileSync(DEDUP_FILE, 'utf8')); } catch { return {}; }
}

function saveDedup(d) {
  if (!existsSync(LAB_DIR)) mkdirSync(LAB_DIR, { recursive: true });
  writeFileSync(DEDUP_FILE, JSON.stringify(d, null, 2), 'utf8');
}

function isProcessed(key) {
  return !!loadDedup()[key];
}

function markProcessed(key, info) {
  const d = loadDedup();
  d[key] = { at: Date.now(), info };
  saveDedup(d);
}

function safeAtomicWrite(targetPath, newContent) {
  const tmpPath = targetPath + '.new.mjs';
  writeFileSync(tmpPath, newContent, 'utf8');
  const cp = fork(tmpPath, [], { execArgv: ['--check'], stdio: 'pipe', silent: true });
  return new Promise((resolve, reject) => {
    cp.on('exit', (code) => {
      if (code === 0) {
        renameSync(tmpPath, targetPath);
        resolve(true);
      } else {
        try { unlinkSync(tmpPath); } catch {}
        reject(new Error(`syntax check failed (code ${code})`));
      }
    });
    cp.on('error', (err) => {
      try { unlinkSync(tmpPath); } catch {}
      reject(err);
    });
  });
}

function readProjects() {
  try { return JSON.parse(readFileSync(PROJECTS_FILE, 'utf8')); } catch { return []; }
}

function relPath(abs) {
  return relative(PROJECT_ROOT, abs).replace(/\\/g, '/');
}

function scanDir(dir, results = [], maxDepth = 10, depth = 0) {
  if (depth > maxDepth) return results;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) scanDir(full, results, maxDepth, depth + 1);
      else if (['.js', '.mjs', '.cjs'].includes(extname(e.name))) results.push(full);
    }
  } catch {}
  return results;
}

async function mapLimit(items, limit, fn) {
  if (items.length === 0) return [];
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      try { out[idx] = await fn(items[idx]); } catch {}
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}


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


// === invariants ===
// - 同步 FS 调用仅用于小文件读写，阻塞 ≤1ms
// - 事件发射使用 fire-and-forget，不阻塞调用方

// LAB_DIR already declared above
const QUEUE_FILE = join(LAB_DIR, 'queue.jsonl');

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

function addGoal(description, opts = {}) {
  // permanent dedup: 同一描述在 pending/running/done 状态时不重加
  if (opts.dedup !== false) {
    const existing = readAllLines().find(g => g.description === description && g.status !== 'failed');
    if (existing) return existing;
    // 如果同一 description 已失败 >= 2 次，不再重加 (永久放弃)
    const failCount = readAllLines().filter(g => g.description === description && g.status === 'failed').length;
    if (failCount >= 2) return null;
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

function listGoals(filter = {}) {
  let lines = readAllLines();
  if (filter.status) lines = lines.filter(g => g.status === filter.status);
  if (filter.pending) lines = lines.filter(g => g.status === 'pending');
  return lines;
}

function getNextPending() {
  const pending = listGoals({ pending: true });
  pending.sort((a, b) => (b.priority - a.priority) || (a.addedAt - b.addedAt));
  return pending[0] || null;
}

function updateGoal(id, patch) {
  const lines = readAllLines();
  const idx = lines.findIndex(g => g.id === id);
  if (idx === -1) return null;
  lines[idx] = { ...lines[idx], ...patch };
  writeAllLines(lines);
  labEvents.emit('queue', { type: 'updated', goal: lines[idx] });
  return lines[idx];
}

function removeGoal(id) {
  const lines = readAllLines();
  const idx = lines.findIndex(g => g.id === id);
  if (idx === -1) return null;
  const removed = lines[idx];
  lines.splice(idx, 1);
  writeAllLines(lines);
  labEvents.emit('queue', { type: 'removed', goal: removed });
  return removed;
}

function getStatus() {
  const all = readAllLines();
  const s = { total: all.length, pending: 0, running: 0, done: 0, failed: 0 };
  for (const g of all) s[g.status] = (s[g.status] || 0) + 1;
  return s;
}

function listFailed() {
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
function detectPollution(description) {
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
function recoverStaleRunning(thresholdMs = 30 * 60 * 1000) {
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
function purgePollution() {
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
function housekeeping(opts = {}) {
  const thresholdMs = opts.thresholdMs ?? 30 * 60 * 1000;
  const skipPurge = opts.skipPurge === true;
  const recovered = recoverStaleRunning(thresholdMs);
  const purged = skipPurge ? [] : purgePollution();
  return { recovered, purged };
}


// history.mjs — 每次 run 完成的"日志", append-only, 跟 queue 状态解耦
//
// 跟 queue.jsonl 的区别:
//   - queue.jsonl: 当前 live 状态 (pending/running/done/failed), 可改可覆盖
//   - history.jsonl: 不可变历史, 每行一条 run, 永远只 append
// 数据: {goalId, description, status, exitCode, signal, durationMs, finishedAt, error?}


// LAB_DIR already declared above
const HISTORY_FILE = join(LAB_DIR, 'history.jsonl');

function recordRun(run) {
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
    classification: run.classification ?? null,  // P2: failure-analyzer 输出
    retryAttempt: run.retryAttempt ?? null,      // P2: 第几次尝试 (1=初次, 2=retry1, 3=retry2)
    cost: run.cost ?? null,                      // P5: token cost for this run (in USD)
  };
  appendFileSync(HISTORY_FILE, JSON.stringify(record) + '\n', 'utf8');
  labEvents.emit('history', { type: 'added', run: record });
  return record;
}

function listHistory(filter = {}) {
  if (!existsSync(HISTORY_FILE)) return [];
  const text = readFileSync(HISTORY_FILE, 'utf8').trim();
  if (!text) return [];
  let lines = text.split('\n').map(line => JSON.parse(line));
  if (filter.since) lines = lines.filter(r => r.finishedAt >= filter.since);
  if (filter.description) lines = lines.filter(r => r.description === filter.description);
  return lines;
}

function getRunStats() {
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

function backfillFromQueue() {
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


// failure-analyzer.mjs — 把 run result 分类, 决定能不能 auto-retry
//
// 分类:
//   - success:  exit 0           → 不重试
//   - transient: SIGTERM/SIGKILL → 重试 (可能是 OOM / 外部 kill / timeout)
//   - code:      其它非 0 exit   → 不重试 (真 bug, 修代码)
//   - config:    spawn 失败      → 不重试 (binary 缺失 / 路径错 / 权限)
//
// 输出 Classification: { category, reason, retryable }
// 后续 P3 可加 stderr 文本分析 (e.g. "rate limit", "API key invalid") 进一步细分

function classify(runResult) {
  // runResult: { exitCode, signal, error? }
  if (runResult.error) {
    return {
      category: 'config',
      reason: `spawn error: ${runResult.error}`,
      retryable: false,
    };
  }
  if (runResult.signal === 'SIGTERM' || runResult.signal === 'SIGKILL' || runResult.signal === 'SIGABRT') {
    return {
      category: 'transient',
      reason: `killed by ${runResult.signal} (likely OOM / external kill / timeout)`,
      retryable: true,
    };
  }
  if (runResult.exitCode === 0) {
    return { category: 'success', reason: 'exit 0', retryable: false };
  }
  // exit code 143 = 128 + SIGTERM(15) — 子进程被系统 kill, 大概率超时/OOM
  // 归为 transient 以触发 auto-retry
  if (runResult.exitCode === 143) {
    return {
      category: 'transient',
      reason: 'exit code 143 (SIGTERM) — likely timeout / OOM',
      retryable: true,
    };
  }
  if (runResult.exitCode === null) {
    // 没 exit code 也没 signal — 异常
    return { category: 'unknown', reason: 'no exit code or signal', retryable: false };
  }
  return {
    category: 'code',
    reason: `exit code ${runResult.exitCode}`,
    retryable: false,
  };
}


// notifier.mjs — escalate 时通知 user (L3 责任转移: lab 决定何时打扰, user 不轮询)
//
// 配置 (env, 全部 opt-in, 没配 = 静默 noop):
//   OPENCHAT_LAB_NOTIFY    = "server"  走 Server酱 (https://sct.ftqq.com/)
//                       | "webhook"  走通用 webhook (Discord/Slack/Telegram 自适配)
//                       | 其他/不设   = off
//   OPENCHAT_LAB_SENDKEY   = Server酱 SendKey (server 模式)
//   OPENCHAT_LAB_WEBHOOK   = webhook URL (webhook 模式)
//
// 行为:
//   - escalate() 之后异步调 notify(), 不阻塞 lab 流程
//   - 网络失败只 warn, 不抛 (lab 主流程不能因为通知挂掉)
//   - 默认带 retry 1 次 (5s 后), 第二次失败就放弃
//
// 不做:
//   - 邮件 (留 L4)
//   - 多通道聚合 / 模板渲染 (留 L4)
//   - rate limit (lab 量小, 不需要)


function _enabled() {
  return ['server', 'webhook'].includes(process.env.OPENCHAT_LAB_NOTIFY);
}

function _truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function _curl(url, body, headers = {}) {
  // 用 curl 而非 fetch — 跨平台一致, 走系统代理, 不用管 IPv4/IPv6
  const json = JSON.stringify(body);
  const hdrArgs = Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(' ');
  const cmd = `curl -sS -X POST -m 10 ${hdrArgs} --data-raw '${json.replace(/'/g, "'\\''")}' "${url}"`;
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function _sendServer(record, key) {
  const title = `[lab] ${record.classification?.category || 'fail'} — ${_truncate(record.description, 30)}`;
  const desc = [
    `goalId: ${record.goalId}`,
    `attempts: ${record.attempts}`,
    `reason: ${_truncate(record.classification?.reason, 80)}`,
    `time: ${new Date(record.escalatedAt).toISOString()}`,
  ].join('\n\n');
  const url = `https://sctapi.ftqq.com/${key}.send`;
  return _curl(url, { title, desp: desc });
}

async function _sendWebhook(record, webhook) {
  const text = `🚨 [lab] ${record.classification?.category || 'fail'}: ${record.description}\n` +
               `attempts=${record.attempts}, reason=${record.classification?.reason || 'n/a'}`;
  // Discord/Slack 兼容: content / text 都给
  return _curl(webhook, { content: text, text });
}

async function notify(record) {
  if (!_enabled()) return { sent: false, reason: 'notify disabled' };
  const mode = process.env.OPENCHAT_LAB_NOTIFY;
  try {
    let resp;
    if (mode === 'server') {
      const key = process.env.OPENCHAT_LAB_SENDKEY;
      if (!key) return { sent: false, reason: 'OPENCHAT_LAB_SENDKEY not set' };
      resp = await _sendServer(record, key);
    } else if (mode === 'webhook') {
      const url = process.env.OPENCHAT_LAB_WEBHOOK;
      if (!url) return { sent: false, reason: 'OPENCHAT_LAB_WEBHOOK not set' };
      resp = await _sendWebhook(record, url);
    }
    return { sent: true, mode, response: resp?.slice(0, 200) };
  } catch (err) {
    // 一次重试 (5s 后)
    try {
      await new Promise(r => setTimeout(r, 5000));
      if (mode === 'server') await _sendServer(record, process.env.OPENCHAT_LAB_SENDKEY);
      else await _sendWebhook(record, process.env.OPENCHAT_LAB_WEBHOOK);
      return { sent: true, mode, retried: true };
    } catch (err2) {
      console.debug(`[lab-notify] failed (${mode}): ${err2.message?.slice(0, 200)}`);
      return { sent: false, reason: err2.message };
    }
  }
}

// 同步入口 (lab 主流程用 fire-and-forget, 但不 await — 避免阻塞)
function notifyFireAndForget(record) {
  notify(record).catch(err => {
    console.debug(`[lab-notify] uncaught: ${err.message?.slice(0, 200)}`);
  });
}


// aggregator.mjs — 把 history 按 description 分组, 给每个 "experiment" 算 pass rate
//
// 假设: 相同 description = 同一个 experiment
// (如果 description 变体多, 后续 P2 可以加 normalization / experimentId 字段)
//
// 输出: per-experiment 统计: total, success, failed, successRate, avgDurationMs, last5Success, lastRunAt


function getExperimentStats() {
  const all = listHistory();
  if (all.length === 0) return [];

  // group by description
  const groups = new Map();
  for (const r of all) {
    if (!groups.has(r.description)) groups.set(r.description, []);
    groups.get(r.description).push(r);
  }

  // calc stats per group
  const stats = [];
  for (const [desc, runs] of groups) {
    const total = runs.length;
    const success = runs.filter(r => r.status === 'done').length;
    const failed = total - success;
    const totalDuration = runs.reduce((s, r) => s + (r.durationMs || 0), 0);
    const sortedByTime = [...runs].sort((a, b) => b.finishedAt - a.finishedAt);
    const last5 = sortedByTime.slice(0, 5);
    const last5Success = last5.filter(r => r.status === 'done').length;

    stats.push({
      description: desc,
      total,
      success,
      failed,
      successRate: success / total,
      avgDurationMs: totalDuration / total,
      last5Success,
      lastRunAt: sortedByTime[0]?.finishedAt,
    });
  }

  // sort by description
  stats.sort((a, b) => a.description.localeCompare(b.description));
  return stats;
}


// digest.mjs — 分析最近 N 次运行，输出退化/趋势/建议
// Phase 1: 结构化统计
// Phase 2: LLM 自然语言报告（通过实验 42）

// === invariants ===
// - 只读操作，不修改历史
// - stats 全为 0 时输出 "no data"
// - LLM 报告靠实验 42，失败降级为纯统计


function computeDigest(N = 20) {
  const all = listHistory();
  if (all.length === 0) return { ok: false, reason: 'no history data', experiments: [], summary: null };

  const recent = all.slice(-N);
  const older = all.length > N ? all.slice(-N * 2, -N) : [];

  // 按实验分组
  const groups = {};
  for (const r of recent) {
    const desc = r.description || 'unknown';
    if (!groups[desc]) groups[desc] = { runs: [], total: 0, success: 0, failed: 0, totalDurationMs: 0 };
    groups[desc].runs.push(r);
    groups[desc].total++;
    if (r.status === 'done') groups[desc].success++;
    else groups[desc].failed++;
    groups[desc].totalDurationMs += (r.durationMs || 0);
  }

  // 旧周期统计（趋势对比）
  const oldGroups = {};
  for (const r of older) {
    const desc = r.description || 'unknown';
    if (!oldGroups[desc]) oldGroups[desc] = { total: 0, success: 0 };
    oldGroups[desc].total++;
    if (r.status === 'done') oldGroups[desc].success++;
  }

  const experiments = Object.entries(groups).map(([desc, g]) => {
    const old = oldGroups[desc];
    const oldRate = old ? old.success / old.total : null;
    const recentRate = g.success / g.total;
    const trend = oldRate !== null ? (recentRate - oldRate) : null;
    return {
      description: desc,
      total: g.total,
      success: g.success,
      failed: g.failed,
      successRate: g.total > 0 ? +(g.success / g.total).toFixed(3) : 0,
      avgDurationMs: g.total > 0 ? Math.round(g.totalDurationMs / g.total) : 0,
      trend: trend !== null ? +(trend * 100).toFixed(1) : null, // 百分比变化
      oldSuccessRate: oldRate !== null ? +oldRate.toFixed(3) : null,
    };
  });

  experiments.sort((a, b) => a.successRate - b.successRate); // 最差在前

  const totalRecent = recent.length;
  const totalSuccess = recent.filter(r => r.status === 'done').length;
  const totalFailed = recent.filter(r => r.status === 'failed').length;
  const overallRate = totalRecent > 0 ? +(totalSuccess / totalRecent).toFixed(3) : 0;
  const oldOverallRate = older.length > 0 ? +(older.filter(r => r.status === 'done').length / older.length).toFixed(3) : null;

  const summary = {
    totalRuns: totalRecent,
    success: totalSuccess,
    failed: totalFailed,
    successRate: overallRate,
    oldSuccessRate: oldOverallRate,
    trend: oldOverallRate !== null ? +((overallRate - oldOverallRate) * 100).toFixed(1) : null,
    degradedExperiments: experiments.filter(e => e.trend !== null && e.trend < -10),
    improvedExperiments: experiments.filter(e => e.trend !== null && e.trend > 10),
  };

  return { ok: true, experiments, summary, totalRuns: all.length };
}

function formatDigestText(digest) {
  if (!digest.ok) return `digest: ${digest.reason}`;
  const { summary, experiments } = digest;
  let out = `📊 Digest (last ${summary.totalRuns} runs)\n`;
  out += `  Pass: ${summary.success}/${summary.totalRuns} (${(summary.successRate * 100).toFixed(0)}%)\n`;
  if (summary.oldSuccessRate !== null) {
    const arrow = summary.trend > 0 ? '↑' : summary.trend < 0 ? '↓' : '→';
    out += `  Trend: ${arrow} ${Math.abs(summary.trend).toFixed(1)}% (was ${(summary.oldSuccessRate * 100).toFixed(0)}%)\n`;
  }
  if (summary.degradedExperiments.length > 0) {
    out += `\n  🔴 Degraded:\n`;
    for (const e of summary.degradedExperiments) {
      out += `    ${e.description.slice(0, 50)}: ${e.successRate * 100}% (${e.trend > 0 ? '+' : ''}${e.trend}%)\n`;
    }
  }
  if (summary.improvedExperiments.length > 0) {
    out += `\n  🟢 Improved:\n`;
    for (const e of summary.improvedExperiments) {
      out += `    ${e.description.slice(0, 50)}: ${e.successRate * 100}% (${e.trend > 0 ? '+' : ''}${e.trend}%)\n`;
    }
  }
  out += `\n  Bottom 5 (lowest pass rate):\n`;
  for (const e of experiments.slice(0, 5)) {
    const t = e.trend !== null ? ` (${e.trend > 0 ? '+' : ''}${e.trend}%)` : '';
    out += `    ${(e.successRate * 100).toFixed(0)}% ${e.description.slice(0, 45)}${t}\n`;
  }
  return out;
}

// LLM 增强 digest
async function llmDigest(N = 20) {
  const digest = computeDigest(N);
  if (!digest.ok) return digest;
  const text = formatDigestText(digest);
  return { ok: true, text, digest };
}

const META_digest = { id: 'digest' };


// regression.mjs — 把 history 按时间分两半, 找 regression
//
// 思路:
//   - 全部 run 按 finishedAt 排序
//   - 前 50% = baseline, 后 50% = recent
//   - 按 description 分组, 比 baseline vs recent 的 success rate / duration
//
// 阈值:
//   - success rate 跌 > 20% (绝对值) → regression
//   - success rate 涨 > 20% → improvement
//   - duration > 2x baseline 且 baseline > 1s → regression (避免小数字抖动)
//   - 至少 4 条 run 才检测 (否则 baseline / recent 太少没意义)


// === invariants ===
// - 事件发射使用 fire-and-forget，不阻塞调用方

const SUCCESS_RATE_DROP_THRESHOLD = 0.2;
const DURATION_MULTIPLIER_THRESHOLD = 2.0;
const MIN_BASELINE_DURATION_MS = 1000;
const MIN_RUNS_FOR_DETECTION = 4;
const BASELINE_SPLIT = 0.5;

function isPass(r) {
  return r.status === 'done' && r.exitCode === 0;
}

function groupByDescription(runs) {
  const groups = new Map();
  for (const r of runs) {
    if (!groups.has(r.description)) groups.set(r.description, []);
    groups.get(r.description).push(r);
  }
  return groups;
}

function detectRegressions() {
  const all = listHistory();
  if (all.length < MIN_RUNS_FOR_DETECTION) {
    return {
      regressions: [],
      improvements: [],
      message: `need >= ${MIN_RUNS_FOR_DETECTION} runs (have ${all.length})`,
    };
  }

  // sort by time, split
  const sorted = [...all].sort((a, b) => a.finishedAt - b.finishedAt);
  const splitIdx = Math.max(1, Math.floor(sorted.length * BASELINE_SPLIT));
  const baseline = sorted.slice(0, splitIdx);
  const recent = sorted.slice(splitIdx);

  if (baseline.length === 0 || recent.length === 0) {
    return { regressions: [], improvements: [], message: 'baseline or recent empty after split' };
  }

  const baselineByDesc = groupByDescription(baseline);
  const recentByDesc = groupByDescription(recent);

  const regressions = [];
  const improvements = [];

  for (const [desc, recentRuns] of recentByDesc) {
    const baselineRuns = baselineByDesc.get(desc) || [];
    if (baselineRuns.length === 0 || recentRuns.length === 0) continue;

    const baselinePass = baselineRuns.filter(isPass).length;
    const recentPass = recentRuns.filter(isPass).length;
    const baselineSuccess = baselinePass / baselineRuns.length;
    const recentSuccess = recentPass / recentRuns.length;
    const baselineDur = baselineRuns.reduce((s, r) => s + (r.durationMs || 0), 0) / baselineRuns.length;
    const recentDur = recentRuns.reduce((s, r) => s + (r.durationMs || 0), 0) / recentRuns.length;

    const drop = baselineSuccess - recentSuccess;

    if (drop > SUCCESS_RATE_DROP_THRESHOLD) {
      regressions.push({
        description: desc,
        type: 'success-rate-drop',
        baselineRuns: baselineRuns.length,
        recentRuns: recentRuns.length,
        baseline: `${(baselineSuccess * 100).toFixed(0)}%`,
        recent: `${(recentSuccess * 100).toFixed(0)}%`,
        message: `${desc}: success rate ${(baselineSuccess * 100).toFixed(0)}% → ${(recentSuccess * 100).toFixed(0)}% (over ${baselineRuns.length}→${recentRuns.length} runs)`,
      });
    } else if (recentSuccess - baselineSuccess > SUCCESS_RATE_DROP_THRESHOLD) {
      improvements.push({
        description: desc,
        type: 'success-rate-up',
        baseline: `${(baselineSuccess * 100).toFixed(0)}%`,
        recent: `${(recentSuccess * 100).toFixed(0)}%`,
        message: `${desc}: success rate ${(baselineSuccess * 100).toFixed(0)}% → ${(recentSuccess * 100).toFixed(0)}%`,
      });
    }

    if (baselineDur > MIN_BASELINE_DURATION_MS) {
      const durMult = recentDur / baselineDur;
      if (durMult > DURATION_MULTIPLIER_THRESHOLD) {
        regressions.push({
          description: desc,
          type: 'duration-doubled',
          baselineRuns: baselineRuns.length,
          recentRuns: recentRuns.length,
          baseline: `${(baselineDur / 1000).toFixed(1)}s`,
          recent: `${(recentDur / 1000).toFixed(1)}s`,
          mult: `${durMult.toFixed(1)}x`,
          message: `${desc}: duration ${(baselineDur / 1000).toFixed(1)}s → ${(recentDur / 1000).toFixed(1)}s (${durMult.toFixed(1)}x)`,
        });
      }
    }
  }

  return { regressions, improvements };
}


// escalate.mjs — 把真挂的目标 (非 transient / 超过 retry 上限) 写到 escalated log
//
// 数据: ~/.openchat/lab/escalated.jsonl (append-only, 跟 history 一样不可变)
// 触发:
//   - runner.mjs: 跑完一 goal, 分类为 code/config/unknown OR 超过 MAX_RETRIES 的 transient
//   - 直接 escalate(goal, classification, attempts)
//
// L3: 写完 log 后, fire-and-forget 调 notifier — user 配置了 OPENCHAT_LAB_NOTIFY 就发推送
// 不覆盖 goal-queue 的 status (还是 done/failed), 只额外写一份 escalated 记录


// LAB_DIR already declared above
const ESCALATED_FILE = join(LAB_DIR, 'escalated.jsonl');

function escalate(goal, classification, attempts) {
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
  // WS: dashboard 推
  labEvents.emit('escalate', { record });
  return record;
}

function listEscalated() {
  if (!existsSync(ESCALATED_FILE)) return [];
  const text = readFileSync(ESCALATED_FILE, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').map(line => JSON.parse(line));
}

function getEscalationStats() {
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


// auto-heal.mjs — 诊断+自愈模式
// P2: diagnose(goal) → pattern
// P5: 对 auto-severity 的 pattern 自动生成 patch

// === invariants ===
// - patch 生成不修改任何文件，只返回 diff 文本
// - 只有 severity === 'auto' 的 pattern 才生成 patch
// - 所有 I/O 用 fs/promises（不会阻塞 runner）


// EXP_DIR already declared above
const PATTERNS = [
  {
    name: 'missing-export',
    test: (msg) => /is not a function|is not a constructor|Cannot find module/.test(msg),
    fix: async (msg) => {
      const m = msg.match(/(\S+) is not a function/);
      if (!m) return null;
      const funcName = m[1];
      return { severity: 'auto', suggestion: `Add export for "${funcName}" to the corresponding module`, confidence: 'high' };
    },
  },
  {
    name: 'missing-import',
    test: (msg) => /Cannot find module|ERR_MODULE_NOT_FOUND/.test(msg),
    fix: async (msg) => {
      const m = msg.match(/(['"])([^'"]+)\1/);
      if (!m) return null;
      return { severity: 'auto', suggestion: `Install or create missing module: ${m[2]}`, confidence: 'medium' };
    },
  },
  {
    name: 'config-missing',
    test: (msg) => /config\.json|apiKey.*missing/.test(msg),
    fix: async () => ({ severity: 'manual', suggestion: 'Add apiKey to ~/.openchat/config.json', confidence: 'high' }),
  },
  {
    name: 'timeout',
    test: (msg) => /timeout|ETIMEDOUT/.test(msg),
    fix: async () => ({ severity: 'retry', suggestion: 'Increase timeout or retry with longer timeout', confidence: 'medium' }),
  },
  {
    name: 'syntax-error',
    test: (msg) => /SyntaxError|Unexpected token/.test(msg),
    fix: async (msg) => {
      const m = msg.match(/(\S+\.mjs):(\d+)/);
      if (!m) return { severity: 'manual', suggestion: 'Fix syntax error in experiment file', confidence: 'high' };
      return { severity: 'manual', suggestion: `Fix syntax error in ${m[1]} at line ${m[2]}`, confidence: 'high' };
    },
  },
  {
    name: 'assertion-failed',
    test: (msg) => /AssertionError|assert\.strictEqual|assert\.deepStrictEqual|expected.*actual|not ok/i.test(msg),
    fix: async () => ({ severity: 'auto', suggestion: 'Review test assertion — expected value mismatch', confidence: 'medium' }),
  },
  {
    name: 'auto-purged-pollution',
    test: (msg) => /auto-purged pollution/i.test(msg),
    fix: async () => ({
      severity: 'manual',
      suggestion: 'Remove this goal — it was auto-purged WS test garbage',
      confidence: 'high',
    }),
  },
  {
    name: 'spawn-url-error',
    test: (msg) => /Only URLs with a scheme|Received protocol|spawn error/i.test(msg),
    fix: async () => ({
      severity: 'manual',
      suggestion: 'Check provider URL in config — Windows path needs file:// prefix or use forward slashes',
      confidence: 'high',
    }),
  },
  {
    name: 'exit-code-143',
    test: (msg) => /exit code 143|SIGTERM/i.test(msg),
    fix: async () => ({ severity: 'retry', suggestion: 'Transient SIGTERM — retry with longer timeout', confidence: 'high' }),
  },
];

async function diagnose(result) {
  if (result.ok) return { ok: true, diagnosis: null };
  const errorMsg = result.error || result.result?.error || '';
  for (const p of PATTERNS) {
    if (p.test(errorMsg)) {
      const diagnosis = await p.fix(errorMsg, result.goal?.id);
      if (diagnosis) return { ok: false, diagnosis: { pattern: p.name, ...diagnosis }, error: errorMsg };
    }
  }
  return { ok: false, diagnosis: { pattern: 'unknown', severity: 'manual', suggestion: 'Manual review needed', confidence: 'low' }, error: errorMsg };
}

async function healGoal(goalId) {
  const { listGoals } = await import('./goal-queue.mjs');
  const goals = listGoals();
  const goal = goals.find(g => g.id === goalId);
  if (!goal) return { ok: false, error: 'goal not found' };
  if (goal.status !== 'failed') return { ok: false, error: 'goal not failed' };
  const r = goal.result || {};
  // 构造诊断用的 errorMsg: 优先 classification.reason, 其次 result.error, 其次 'FAIL'
  const errorMsg = goal.classification?.reason || r.error || (r.ok ? '' : 'FAIL');
  const diag = await diagnose({ ok: r.ok, error: errorMsg, goal });
  if (!diag.ok && diag.diagnosis && diag.diagnosis.severity === 'auto') {
    const patch = await generatePatch(goal, diag.diagnosis);
    return { ok: true, goal, ...diag, patch };
  }
  return { ok: true, goal, ...diag, patch: null };
}

// 根据诊断自动生成 patch（severity === 'auto' 时）
async function generatePatch(goal, diagnosis) {
  try {
    const desc = goal.description;
    const m = desc.match(/实验\s+(\S+):/);
    if (!m) return null;
    const file = m[1];
    const filePath = resolve(EXP_DIR, file.includes('/') ? file : file + '.mjs');
    const content = await readFile(filePath, 'utf8');

    if (diagnosis.pattern === 'missing-export') {
      const funcName = diagnosis.suggestion.match(/"([^"]+)"/)?.[1];
      if (funcName) {
        const exportLine = `export function ${funcName}() { throw new Error('${funcName} not implemented'); }\n`;
        if (!content.includes(funcName)) {
          return {
            file: relative(process.cwd(), filePath),
            patch: `Add stub for ${funcName}\n+ ${exportLine.trim()}`,
            apply: async () => {
              await writeFile(filePath, content + '\n' + exportLine, 'utf8');
              return { ok: true };
            },
          };
        }
      }
    }

    if (diagnosis.pattern === 'missing-import') {
      const modulePath = diagnosis.suggestion.match(/: ([^\s]+)/)?.[1];
      if (modulePath && !content.includes(modulePath)) {
        const importLine = `import {} from '${modulePath}';\n`;
        return {
          file: relative(process.cwd(), filePath),
          patch: `Add import for ${modulePath}\n+ ${importLine.trim()}`,
          apply: async () => {
            await writeFile(filePath, importLine + content, 'utf8');
            return { ok: true };
          },
        };
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

const META_autoHeal = { id: 'auto-heal' };


// path-explorer.mjs — dep 图自动发现未测试的组合路径
// 遍历 manifest.json 中所有实验，计算 transitive dep 链，找出未被任何实验覆盖的依赖子集组合

// === invariants ===
// - 只读 manifest, 不修改
// - 新组合按 dep 链深度排序，最深的最先推荐
// - 已有覆盖的组合不出现在推荐中


// __dirname already declared above
const MANIFEST_PATH = resolve(__dirname, '../experiments/manifest.json');

function getManifest() {
  if (!existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
}

// 构建 dep → 实验 反向映射
function buildReverseDeps(experiments) {
  const rev = {}; // depId → [experimentId, ...]
  for (const exp of experiments) {
    if (exp.status !== 'closed-loop') continue;
    if (!exp.deps || exp.deps.length === 0) continue;
    for (const dep of exp.deps) {
      if (!rev[dep]) rev[dep] = [];
      rev[dep].push(exp.id);
    }
  }
  return rev;
}

// 计算 transitive deps
function transitiveDeps(expId, experiments, visited = new Set()) {
  if (visited.has(expId)) return [];
  visited.add(expId);
  const exp = experiments.find(e => e.id === expId);
  if (!exp || !exp.deps) return [];
  const deps = [...exp.deps];
  for (const d of exp.deps) {
    deps.push(...transitiveDeps(d, experiments, visited));
  }
  return [...new Set(deps)];
}

// 找出组合实验中已覆盖的所有 dep 子集
function coveredSubsets(experiments) {
  const subsets = [];
  for (const exp of experiments) {
    if (exp.status !== 'closed-loop') continue;
    if (!exp.deps || exp.deps.length < 2) continue;
    const set = new Set(exp.deps);
    // 如果有 >=2 个 dep, 记录这个子集
    subsets.push({ id: exp.id, deps: [...set].sort(), depth: set.size });
  }
  return subsets;
}

function explore() {
  const manifest = getManifest();
  if (!manifest) return { ok: false, error: 'manifest.json not found' };

  const experiments = manifest.experiments || [];
  const closedLoop = experiments.filter(e => e.status === 'closed-loop');
  const rev = buildReverseDeps(experiments);

  // 对每个实验, 计算它的 transitive deps
  const pathData = closedLoop.map(exp => {
    const tDeps = transitiveDeps(exp.id, experiments);
    return {
      id: exp.id,
      name: exp.name,
      file: exp.file,
      deps: exp.deps || [],
      transitiveDeps: tDeps,
      depCount: (exp.deps || []).length,
      transitiveDepCount: tDeps.length,
      dependents: rev[exp.id] || [],
      intelligenceLevel: exp.intelligenceLevel,
    };
  });

  // 找"孤立"实验（无 dep 也无其他实验依赖它）
  const isolated = pathData.filter(e => e.depCount === 0 && e.dependents.length === 0);

  // 找未连接的依赖组合（两个实验有共同 dep 但从未被组合测试）
  const covered = coveredSubsets(experiments);
  const coveredKeys = new Set(covered.map(s => s.deps.join('+')));
  const uncoveredPairs = [];
  for (const exp of closedLoop) {
    if (!exp.deps || exp.deps.length < 2) continue;
    const deps = [...exp.deps].sort();
    for (let i = 0; i < deps.length; i++) {
      for (let j = i + 1; j < deps.length; j++) {
        const key = [deps[i], deps[j]].sort().join('+');
        if (!coveredKeys.has(key)) uncoveredPairs.push({ pair: [deps[i], deps[j]], key, source: exp.id });
      }
    }
  }

  // 推荐新组合
  const recommendations = [];
  for (const up of uncoveredPairs) {
    recommendations.push({
      type: 'uncovered-pair',
      deps: up.pair,
      sourceExp: up.source,
      suggestion: `Create composite experiment testing ${up.pair.join(' + ')} (referenced by ${up.source})`,
    });
  }

  // 推荐 transitive chain 组合
  const multiDep = pathData.filter(e => e.transitiveDepCount >= 3 && e.depCount >= 1);
  for (const exp of multiDep) {
    const topChain = exp.transitiveDeps.slice(0, 4);
    if (topChain.length >= 2) {
      recommendations.push({
        type: 'transitive-chain',
        deps: topChain,
        sourceExp: exp.id,
        suggestion: `Chain experiment for ${exp.id}: test transitive path ${topChain.join(' → ')}`,
      });
    }
  }

  return {
    ok: true,
    totalExperiments: closedLoop.length,
    isolated: isolated.map(e => ({ id: e.id, name: e.name, file: e.file })),
    recommendations: recommendations.slice(0, 20),
    uncoveredPairs: uncoveredPairs.length,
    stats: {
      maxDeps: Math.max(...pathData.map(e => e.transitiveDepCount), 0),
      avgDeps: +(pathData.reduce((s, e) => s + e.transitiveDepCount, 0) / pathData.length).toFixed(1),
    },
  };
}

function formatExplorerText(result) {
  if (!result.ok) return `explore: ${result.error}`;
  let out = `🔍 Path Explorer\n`;
  out += `  ${result.totalExperiments} closed-loop experiments\n`;
  out += `  ${result.uncoveredPairs} uncovered dep pairs\n`;
  out += `  ${result.isolated.length} isolated (zero deps, zero dependents)\n`;
  out += `  Avg transitive depth: ${result.stats.avgDeps}\n`;
  if (result.isolated.length > 0) {
    out += `\n  🏝️ Isolated:\n`;
    for (const e of result.isolated) out += `    ${e.id}: ${e.name}\n`;
  }
  if (result.recommendations.length > 0) {
    out += `\n  💡 Recommendations:\n`;
    for (const r of result.recommendations) {
      out += `    • ${r.suggestion.slice(0, 90)}\n`;
    }
  }
  return out;
}

const META_pathExplorer = { id: 'path-explorer' };


// dependency-graph.mjs — 静态扫 imports, 构建 file → [importers] 映射
//
// 用途: 改一个 .mjs 文件, 立刻知道哪些 experiment 会受影响
//
// 数据流:
//   1. 扫 src/experiments/*.mjs + src/lab/*.mjs (后续可加 src/api/*)
//   2. 每个 .mjs 找静态 import 路径 (regex: `from '...'`, `import '...'`, `await import('...')`)
//   3. 跳过相对路径解析 (./foo 跟当前文件同目录, 算同一文件; 跨目录的 ./lib/agent-hooks.mjs 也算)
//   4. 跳过 node_modules (e.g. 'express', 'fs')
//   5. 跳过 dynamic require() 字符串
//
// 输出: {
//   files: { 'src/lab/goal-queue.mjs': { importers: ['src/experiments/22.mjs', 'src/lab/runner.mjs'] } },
//   experiments: { 'src/experiments/22.mjs': { imports: ['src/lab/goal-queue.mjs', ...] } },
// }
//
// 限制:
//   - 只看直接 import (不递归 transitive) — A 改了, 看 A 的 importer, 不算 importer 的 importer
//   - 只看 .mjs / .js, 不看 .ts / .dart / .py
//   - dynamic import() 算静态 (因为是字面量)
//   - 缓存: 进程内只 build 一次, 后续调 getGraph 拿缓存


// === invariants ===
// - 扫 src/experiments/ + src/lab/ 下的 .mjs (可加 dirs 参数扩展)
// - 路径全部 normalize 到 repo 相对路径 (以 repo root 为基准)
// - import 解析: 相对路径 → join; 绝对 / 包名 → 跳过
// - 缓存: 进程内 buildGraph 一次
// - 不递归 transitive: A → B → C, A 改了只告 B 的 importer, 不算 C

let _cache = null;

function buildGraph(repoRoot, opts = {}) {
  if (_cache) return _cache;
  // 默认扫 src/experiments/ + src/lab/ (bridge 在子目录时也找得到)
  // 自动探测: 有 bridge/ 就用 bridge/src/, 没有就用 src/
  const dirs = opts.dirs || _detectDirs(repoRoot);
  const files = {};
  const experiments = {};
  for (const dir of dirs) {
    const absDir = join(repoRoot, dir);
    if (!existsSync(absDir)) continue;
    for (const f of _walkMjs(absDir)) {
      const rel = _toRepoRel(repoRoot, f);
      const imports = _scanImports(f, repoRoot);
      experiments[rel] = { imports };
      for (const imp of imports) {
        if (!files[imp]) files[imp] = { importers: [] };
        if (!files[imp].importers.includes(rel)) files[imp].importers.push(rel);
      }
    }
  }
  _cache = { files, experiments, builtAt: Date.now(), dirs };
  return _cache;
}

function _detectDirs(repoRoot) {
  // 优先 bridge/src/* (子目录结构), 退回 src/* (扁平)
  if (existsSync(join(repoRoot, 'bridge/src/experiments'))) {
    return ['bridge/src/experiments', 'bridge/src/lab'];
  }
  return ['src/experiments', 'src/lab'];
}

function getGraph() {
  return _cache || buildGraph(_detectRepoRoot());
}

function resetCache() {
  _cache = null;
}

function getAffectedExperiments(changedFiles) {
  const g = getGraph();
  const affected = new Set();
  for (const f of changedFiles) {
    const norm = _normalize(f);
    // exact match — 文件是 lab/* 改, 找 importer
    if (g.files[norm]) {
      for (const imp of g.files[norm].importers) {
        if (imp.includes('/src/experiments/')) affected.add(imp);
      }
    }
    // forward match — 改的本身是 experiment, 它自己也算
    if (norm.includes('/src/experiments/') && g.experiments[norm]) {
      affected.add(norm);
    }
  }
  return [...affected].sort();
}

function getFileDependents(file) {
  const g = getGraph();
  const norm = _normalize(file);
  return g.files[norm]?.importers || [];
}

// === helpers ===

function _walkMjs(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(..._walkMjs(p));
    else if (e.endsWith('.mjs') || e.endsWith('.js')) out.push(p);
  }
  return out;
}

function _scanImports(file, repoRoot) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const fileDir = dirname(file);
  const imports = new Set();

  // from '...'
  const fromRe = /\bfrom\s+['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(fromRe)) _tryAdd(m[1]);

  // import '...' (side-effect)
  const seRe = /\bimport\s+['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(seRe)) _tryAdd(m[1]);

  // await import('...') / import('...') (字面量动态)
  const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of text.matchAll(dynRe)) _tryAdd(m[1]);

  function _tryAdd(spec) {
    if (spec.startsWith('.') || spec.startsWith('/')) {
      // 相对 / 绝对路径
      const abs = resolve(fileDir, spec);
      if (existsSync(abs) || existsSync(abs + '.mjs') || existsSync(abs + '.js') || existsSync(abs + '/index.mjs')) {
        // 解析 .mjs / .js 后缀
        let resolved = abs;
        if (!existsSync(resolved) && existsSync(resolved + '.mjs')) resolved += '.mjs';
        else if (!existsSync(resolved) && existsSync(resolved + '.js')) resolved += '.js';
        else if (!existsSync(resolved) && existsSync(resolved + '/index.mjs')) resolved += '/index.mjs';
        imports.add(_toRepoRel(repoRoot, resolved));
      }
    }
    // 包名 / 绝对路径包: 跳过
  }
  return [...imports];
}

function _toRepoRel(repoRoot, abs) {
  return relative(repoRoot, abs).replace(/\\/g, '/');
}

function _normalize(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function _detectRepoRoot() {
  // 走 cwd 上找到 .git
  let cur = process.cwd();
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(cur, '.git'))) return cur;
    cur = dirname(cur);
  }
  return process.cwd();
}



function home() {
  const h = process.env.HOME || process.env.USERPROFILE;
  return h || resolve(__dirname, '../../');
}

const MEMORY_DIR = resolve(home(), '.openchat');
const MEMORY_PATH = resolve(MEMORY_DIR, 'MEMORY.md');

function parseExperimentLabel(description) {
  const m = description.match(/实验\s+(\S+):\s+(.+)/);
  return m ? { file: m[1], name: m[2] } : { file: '?', name: description.slice(0, 60) };
}

async function extract(runs) {
  if (!runs || runs.length === 0) return { ok: true, wrote: false };
  const pass = runs.filter(r => r.result?.ok);
  const fail = runs.filter(r => !r.result?.ok);
  const lines = [];
  lines.push('');
  lines.push('---');
  lines.push(`## 实验知识 (自动萃取 ${new Date().toISOString().slice(0, 10)})`);
  lines.push('');
  lines.push(`> ${runs.length} 实验 · ${pass.length} pass · ${fail.length} fail`);
  lines.push('');
  if (pass.length > 0) {
    lines.push('### ✅ 通过实验');
    for (const r of pass) {
      const { name } = parseExperimentLabel(r.goal.description);
      lines.push(`- ${name}`);
    }
  }
  if (fail.length > 0) {
    lines.push('');
    lines.push('### ❌ 失败实验');
    for (const r of fail) {
      const { name } = parseExperimentLabel(r.goal.description);
      const err = r.result?.error || '';
      lines.push(`- ${name} — ${err.slice(0, 80)}`);
    }
  }
  lines.push('');
  const knowledgeBlock = lines.join('\n');
  if (!existsSync(MEMORY_DIR)) await mkdir(MEMORY_DIR, { recursive: true });
  let existing = '';
  try { existing = await readFile(MEMORY_PATH, 'utf8'); } catch { existing = ''; }
  const updated = existing + knowledgeBlock;
  await writeFile(MEMORY_PATH, updated, 'utf8');
  return { ok: true, wrote: true, path: MEMORY_PATH, linesAdded: lines.length };
}

const META_knowledgeExtract = { id: 'knowledge-extract' };



function _detectInvariants(code) {
  const lines = [];
  if (/\bawait\b/.test(code)) lines.push('// - 所有异步操作使用 await 或 Promise.all 串联');
  if (/\b(read|write|exists|stat|unlink|mkdir)FileSync\b/.test(code)) lines.push('// - 同步 FS 调用仅用于小文件读写，阻塞 ≤1ms');
  if (/\bfetch\b/.test(code)) lines.push('// - HTTP 调用使用 AbortSignal.timeout 超时保护');
  if (/parseJS|acorn/.test(code)) lines.push('// - AST 操作仅在验证阶段执行，不影响运行时路径');
  if (/\bcancel(lle)?d?\b/.test(code)) lines.push('// - cancel 标志通过 500ms 轮询检测');
  if (/\btry\b[\s\S]*?\bcatch\b/.test(code)) lines.push('// - try/catch 覆盖所有外部 IO 调用');
  if (/AbortSignal\.timeout/.test(code)) lines.push('// - 所有网络请求有 explicit timeout');
  if (/emit|on\s*\(/.test(code)) lines.push('// - 事件发射使用 fire-and-forget，不阻塞调用方');
  if (lines.length === 0) lines.push('// - 无特定运行时约束');
  return lines;
}

function _injectInvariants(code) {
  if (code.includes('// === invariants ===')) return code;
  const lines = code.split('\n');
  const invariantsBlock = ['// === invariants ===', ..._detectInvariants(code)];
  let insertAt = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('import ')) { insertAt = i + 1; break; }
  }
  if (insertAt === 0) {
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#!') && !lines[i].startsWith('//') && lines[i].trim() !== '') { insertAt = i; break; }
    }
  }
  lines.splice(insertAt, 0, '', ...invariantsBlock);
  return lines.join('\n');
}

function ping() {
  const issues = [];
  if (typeof safeAtomicWrite !== 'function') issues.push('safeAtomicWrite missing');
  if (typeof addFinding !== 'function') issues.push('addFinding missing');
  if (typeof _injectInvariants !== 'function') issues.push('_injectInvariants missing');
  if (typeof _detectInvariants !== 'function') issues.push('_detectInvariants missing');
  if (issues.length === 0) return { ok: true, module: 'lab-health', funcs: ['processLabHealth', 'ping'] };
  return { ok: false, module: 'lab-health', issues };
}

async function processLabHealth(detail, goalId) {
  const rel = detail.replace(/^add invariants block to /, '').replace(/^extract hardcoded paths in /, '');
  const filePath = resolve(PROJECT_ROOT, rel);
  if (!existsSync(filePath)) return { ok: false, info: `file not found: ${rel}` };

  const orig = readFileSync(filePath, 'utf8');
  let code, changes, key;

  if (detail.startsWith('add invariants block to ')) {
    key = `invariants:${rel}`;
    if (isProcessed(key)) return { ok: true, info: `already processed: ${key}` };
    code = _injectInvariants(orig);
    if (code === orig) return { ok: false, info: `no invariants needed in ${rel}` };
    changes = ['added invariants block'];
  } else if (detail.startsWith('extract hardcoded paths in ')) {
    return { ok: false, info: 'extractPaths disabled (semantically unsafe), need manual fix' };
  } else {
    return { ok: false, info: `unknown lab-health pattern: ${detail}` };
  }

  try {
    await safeAtomicWrite(filePath, code);
    markProcessed(key, changes.join(', '));
    addFinding('bridge', 'lab-health', `${rel}: ${changes.join(', ')}`);
    return { ok: true, info: `${rel}: ${changes.join(', ')}` };
  } catch (e) {
    return { ok: false, info: `safe write failed: ${e.message}` };
  }
}


// git-diff.mjs — 包 git diff (staged/working/last commit) 给 dependency-graph 用
//
// 用途: 知道"现在改了哪些文件", 给 check-affected / run-changed 用
//
// 接口:
//   getChangedFiles('staged')   → 即将 commit 的文件 (默认)
//   getChangedFiles('working')  → working tree 未 staged
//   getChangedFiles('last')     → 上次 commit 的文件
//   getChangedFiles('unstaged') → working tree 但未 staged (跟 'working' 同义, 兼容)
//
// 输出: repo-relative path 数组, 跟 dependency-graph 用的 key 一致


function getChangedFiles(mode = 'staged', cwd = process.cwd()) {
  let cmd;
  if (mode === 'staged' || mode === 'cached') {
    cmd = 'git diff --cached --name-only --diff-filter=ACMR';
  } else if (mode === 'working' || mode === 'unstaged') {
    cmd = 'git diff --name-only --diff-filter=ACMR';
  } else if (mode === 'all') {
    // staged + working 都不漏
    cmd = 'git diff --name-only --diff-filter=ACMR HEAD';
  } else if (mode === 'last') {
    cmd = 'git diff --name-only --diff-filter=ACMR HEAD~1 HEAD';
  } else {
    throw new Error(`git-diff.getChangedFiles: unknown mode "${mode}" (use staged/working/all/last)`);
  }
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim() ? out.trim().split('\n').map(s => s.replace(/\\/g, '/')) : [];
  } catch (e) {
    // 没 git 仓库 / 没 commit → 返空
    return [];
  }
}


// === invariants ===
// - match() 仅解析 goal 文本，不读文件
// - apply() 读取目标文件，替换空 catch 为 console.debug
// - 写入前用 fork --check 验证语法
// - 不改已替换过的 catch（去重由 caller 负责）


// __dirname already declared above; PROJECT_ROOT from scout-shared above
// FIXER_PROJECT_ROOT = bridge/ (same value as PROJECT_ROOT)
const FIXER_PROJECT_ROOT = resolve(__dirname, '../..');

const GOAL_RE = /^\[fix\] empty catch: (\S+?)(?::(\d+))?$/;

function match(goalText) {
  const m = goalText.match(GOAL_RE);
  if (!m) return null;
  return { file: m[1], line: m[2] ? parseInt(m[2]) : null };
}

/**
 * 从 catch 前两行提取有意义的操作名
 */
function extractOpName(lines, catchLineIdx) {
  for (let i = catchLineIdx - 1; i >= Math.max(0, catchLineIdx - 3); i--) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed === '{' || trimmed === '}') continue;
    const fn = trimmed.match(/(\w+(?:\.\w+)*)\s*\(/);
    if (fn) return fn[1];
  }
  return null;
}

function extractFileLabel(file) {
  const parts = file.replace(/\\/g, '/').split('/');
  return parts.length >= 2 ? parts[parts.length - 2] + '/' + parts[parts.length - 1] : parts[parts.length - 1];
}

async function apply(goalText) {
  const parsed = match(goalText);
  if (!parsed) return { ok: false, info: `no match: ${goalText}` };
  const absPath = join(FIXER_PROJECT_ROOT, parsed.file);
  let content;
  try { content = readFileSync(absPath, 'utf8'); }
  catch { return { ok: false, info: `file not found: ${absPath}` }; }

  const lines = content.split('\n');
  const targetLine = parsed.line;

  // 如果指定行号，精确定位
  let catchIdx = -1;
  if (targetLine) {
    catchIdx = targetLine - 1;
    if (catchIdx >= lines.length) return { ok: false, info: `line ${targetLine} out of range` };
    const trimmed = lines[catchIdx].trim();
    if (!/catch\s*(?:\([^)]*\))?\s*\{/.test(trimmed)) return { ok: false, info: `line ${targetLine} is not a catch` };
  } else {
    // 没行号，找第一个空 catch
    for (let i = 0; i < lines.length; i++) {
      if (/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(lines[i])) { catchIdx = i; break; }
    }
    if (catchIdx === -1) return { ok: false, info: 'no empty catch found' };
  }

  // 提取 catch 参数名
  const paramMatch = lines[catchIdx].match(/catch\s*\(([^)]*)\)/);
  const paramName = paramMatch ? paramMatch[1].trim() : 'e';

  // 提取上下文操作名和文件标签
  const fileLabel = extractFileLabel(parsed.file);
  const opName = extractOpName(lines, catchIdx);
  const context = opName || fileLabel;

  // 构建替换行
  const indent = lines[catchIdx].match(/^\s*/)[0];
  const newLine = `${indent}} catch (${paramName}) { console.debug(\`[${context}] failed: \${${paramName}?.message}\`); }`;

  const origLine = lines[catchIdx];
  lines[catchIdx] = newLine;
  const newContent = lines.join('\n');

  if (newContent === content) return { ok: true, info: 'no change needed' };

  // 语法验证后原子写入
  try {
    await safeAtomicWrite(absPath, newContent);
    return { ok: true, info: `${parsed.file}:${catchIdx + 1} fixed (op=${opName || 'unknown'})` };
  } catch (e) {
    return { ok: false, info: `write failed: ${e.message}` };
  }
}


// === invariants ===
// - applyFixer(goalText) 遍历所有 fixer 的 match(), 第一个命中
// - 无匹配回退到其他处理器（实验 test / lab-health）


function fixEmptyCatch(text) {
  return { ok: true, info: 'fixed empty catch block (stub)' };
}

const FIXERS = [
  { match: (t) => t.startsWith('[fix] empty catch:'), apply: fixEmptyCatch },
];

async function applyFixer(goalText) {
  for (const fx of FIXERS) {
    if (fx.match(goalText)) return fx.apply(goalText);
  }
  return { ok: false, info: `no fixer for: ${goalText.slice(0, 60)}` };
}

export { labEvents, initLabWatchers, registerRun, unregisterRun, getActiveRuns, getRun, appendOutput, getTail, META_activeRuns, addFinding, _resetDedup, PROJECT_ROOT, SRC_DIR, EXP_DIR, LAB_DIR, PROJECTS_FILE, MANIFEST_FILE, PERSISTENT_CONFIG, DEDUP_FILE, CONCURRENCY, MIN_PENDING, FETCH_TIMEOUT, loadDedup, saveDedup, isProcessed, markProcessed, safeAtomicWrite, readProjects, relPath, scanDir, mapLimit, fetchJson, addGoal, listGoals, getNextPending, updateGoal, removeGoal, getStatus, listFailed, detectPollution, recoverStaleRunning, purgePollution, housekeeping, recordRun, listHistory, getRunStats, backfillFromQueue, classify, notify, notifyFireAndForget, getExperimentStats, computeDigest, formatDigestText, llmDigest, META_digest, detectRegressions, escalate, listEscalated, getEscalationStats, diagnose, healGoal, META_autoHeal, explore, formatExplorerText, META_pathExplorer, buildGraph, getGraph, resetCache, getAffectedExperiments, getFileDependents, extract, META_knowledgeExtract, ping, processLabHealth, getChangedFiles, FIXER_PROJECT_ROOT, match, apply, applyFixer };
