// active-runs.mjs — 正在跑的目标注册表
// 供 supervisor 监控 + runner 注册/反注册

// === invariants ===
// - _runs 只在主线程读写，无需锁
// - logLines 上限 100 条，溢出裁头
// - loopCounter 对 logLines 去重（同一行文本计重复次数）
// - registerRun 覆盖旧条目（同 goalId）

const _runs = new Map();

export function registerRun(goalId, opts = {}) {
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

export function unregisterRun(goalId) {
  _runs.delete(goalId);
}

export function getActiveRuns() {
  return [..._runs.values()];
}

export function getRun(goalId) {
  return _runs.get(goalId);
}

export function appendOutput(goalId, text) {
  const run = _runs.get(goalId);
  if (!run) return;
  run.lastOutputAt = Date.now();
  const line = text.replace(/\r?\n$/, '');
  run.logLines.push(line);
  if (run.logLines.length > 100) run.logLines.splice(0, run.logLines.length - 100);
  run.loopCounter[line] = (run.loopCounter[line] || 0) + 1;
}

export function getTail(goalId, n = 10) {
  const run = _runs.get(goalId);
  if (!run) return [];
  return run.logLines.slice(-n);
}

export const META = { id: 'active-runs' };
