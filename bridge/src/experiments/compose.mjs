// compose.mjs — 按 manifest.json 解析依赖、顺序运行、缓存 outputs 的组合运行器
//
// 用法:
//   import { run, compose, list, get, getMeta, reset, printDeps } from './compose.mjs';
//
//   // 1. 单个实验
//   const { encoded } = await run('codec', { op: 'encode', pcm: buffer });
//
//   // 2. 多个实验（自动按 deps 拓扑排序）
//   const { agent, qiniu } = await compose(['config', 'agent', 'qiniu'], {
//     agent: { text: 'hello', chatId: 'c1' },
//   });
//
//   // 3. 列清单 / 看依赖图
//   list();             // → manifest.experiments
//   getMeta('codec');   // → 单个实验的 manifest
//   printDeps('chat-poller');  // → 依赖树
//
// 约定:
//   - 每个实验文件 export `async run({ inputs, deps, manifest })` 返回 { outputs }
//   - 若未 export run() 则 fallback 到 test()（仅作测试，outputs 为 null）
//   - 每个实验 export const META = { id }（可选，调试用）
//   - run-all.mjs 走 test（测试），compose.mjs 走 run（组合）

import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(await readFile(resolve(__dirname, 'manifest.json'), 'utf8'));
const _byId = new Map(MANIFEST.experiments.map(e => [e.id, e]));
const _state = new Map(); // id → { outputs, ts, durationMs }

function _abs(file) { return pathToFileURL(resolve(__dirname, file)).href; }

function _meta(id) {
  const m = _byId.get(id);
  if (!m) throw new Error(`unknown experiment: ${id} (have: ${[..._byId.keys()].join(', ')})`);
  return m;
}

// 拓扑排序：deps 在前
function _resolveOrder(ids) {
  const order = [];
  const seen = new Set();
  function visit(id) {
    if (seen.has(id)) return;
    seen.add(id);
    for (const d of _meta(id).deps || []) visit(d);
    order.push(id);
  }
  for (const id of ids) visit(id);
  return order;
}

async function _runExp(meta, inputs) {
  const mod = await import(_abs(meta.file));
  const t0 = Date.now();

  // 优先 run() — 真正的可组合接口。约定返回 { outputs: {...} }
  if (typeof mod.run === 'function') {
    const deps = {};
    for (const d of meta.deps || []) {
      const s = _state.get(d);
      deps[d] = s ? s.outputs : null;
    }
    const result = await mod.run({ inputs, deps, manifest: meta });
    return { outputs: result, durationMs: Date.now() - t0 };
  }

  // 无 run() — compose 拿不到 outputs。test() 由 run-all.mjs 显式跑，不在此触发。
  if (typeof mod.test === 'function') {
    console.warn(`[compose] ${meta.id} 无 run() — outputs=null, 跑测试请用 run-all.mjs`);
  }
  return { outputs: null, durationMs: Date.now() - t0 };
}

async function _runOne(id, inputs) {
  // 不预跑 deps — 子实验的 inputs 是目标 run() 内部按需传的，用 {} 调会触发必填校验 throw
  // compose() 仍按 deps 拓扑排序并各自传 inputsMap[cur]，那是 caller 显式提供 inputs 的路径
  const meta = _meta(id);
  const { outputs, durationMs } = await _runExp(meta, inputs);
  _state.set(id, { outputs, ts: Date.now(), durationMs });
  return outputs;
}

export async function run(id, inputs = {}) {
  return _runOne(id, inputs);
}

export async function compose(ids, inputsMap = {}) {
  if (!Array.isArray(ids)) throw new Error('compose: ids must be array');
  const order = _resolveOrder(ids);
  for (const cur of order) {
    if (_state.has(cur)) continue;
    const meta = _meta(cur);
    const { outputs, durationMs } = await _runExp(meta, inputsMap[cur] || {});
    _state.set(cur, { outputs, ts: Date.now(), durationMs });
  }
  const out = {};
  for (const id of ids) {
    const s = _state.get(id);
    out[id] = s ? s.outputs : null;
  }
  return out;
}

export function get(id)        { return _state.get(id); }
export function list()         { return MANIFEST.experiments; }
export function getMeta(id)    { return id ? _meta(id) : MANIFEST; }
export function getState()     { return Object.fromEntries(_state); }
export function reset()        { _state.clear(); }

// 依赖树（缩进文本）
export function printDeps(id) {
  const lines = [];
  function visit(id, prefix = '', isLast = true) {
    const m = _meta(id);
    const branch = prefix === '' ? '' : (isLast ? '└─ ' : '├─ ');
    lines.push(`${prefix}${branch}${m.id}  [${m.category}]`);
    const deps = m.deps || [];
    const next = prefix === '' ? '' : (prefix + (isLast ? '   ' : '│  '));
    deps.forEach((d, i) => visit(d, next, i === deps.length - 1));
  }
  visit(id);
  return lines.join('\n');
}

// 汇总：所有实验的 outputs（用于调试/序列化）
export function dump() {
  const out = {};
  for (const [id, s] of _state) out[id] = s;
  return out;
}
