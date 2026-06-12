// agent-hooks.mjs — LLM tool-loop 的 pre/post hook 注册表 (Step 6.1 / L3 整车基础)
//
// 用途: 让 permission / log / 限流 / 撤销 等能力, 以 hook 形式注入到 tool 执行链,
//       不动 22.mjs _execTool 主流程.
//
// 事件:
//   - preTool(tool, args)   — tool 跑前, 抛 throw 终止本次调用
//   - postTool(tool, args, result) — tool 跑后, return 新 result (string)
//
// 调用方 (22.mjs): _execTool 内 await runPre(...) → codingExec → runPost(...)
// 注册方 (lib/permission.mjs 等): on('preTool', 'permission', fn)

const _hooks = new Map(); // event → Map<name, fn>

export function on(event, name, fn) {
  if (event !== 'preTool' && event !== 'postTool') {
    throw new Error(`agent-hooks: unknown event "${event}" (use preTool|postTool)`);
  }
  if (typeof fn !== 'function') throw new Error(`agent-hooks: hook "${name}" must be a function`);
  if (!_hooks.has(event)) _hooks.set(event, new Map());
  _hooks.get(event).set(name, fn);
  return () => off(event, name);  // 返回 unsubscribe
}

export function off(event, name) {
  return _hooks.get(event)?.delete(name) ?? false;
}

export function clear(event) {
  if (event) _hooks.get(event)?.clear();
  else _hooks.clear();
}

// preTool: 顺序跑, 任何抛 throw 中止链 (postTool 仍跑, 用于清理)
export async function runPre(tool, args) {
  const hooks = _hooks.get('preTool');
  if (!hooks) return;
  for (const [name, fn] of hooks) {
    try {
      await fn(tool, args);
    } catch (e) {
      e.hookName = name;
      throw e;
    }
  }
}

// postTool: 顺序跑, 每个 hook 的 return 传给下一个 (chain-of-responsibility).
// 任何 hook throw 不抛, 改 console.warn (post 不应阻断主流程)
export async function runPost(tool, args, result) {
  const hooks = _hooks.get('postTool');
  if (!hooks) return result;
  let cur = result;
  for (const [name, fn] of hooks) {
    try {
      cur = await fn(tool, args, cur);
    } catch (e) {
      console.warn(`[agent-hooks] postTool "${name}" failed: ${e.message}`);
    }
  }
  return cur;
}

export function listHooks() {
  const out = {};
  for (const [event, map] of _hooks) {
    out[event] = [...map.keys()];
  }
  return out;
}

export function getStats() {
  const out = {};
  for (const [event, map] of _hooks) {
    out[event] = map.size;
  }
  return out;
}
