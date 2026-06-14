import { on } from './agent-hooks.mjs';

const _callLog = [];
const MAX_LOG = 100;

export function enableLoggingHook() {
  const unsubPre = on('preTool', 'logger', async (tool, args) => {
    _callLog.push({ type: 'pre', tool, args, time: Date.now() });
    if (_callLog.length > MAX_LOG) _callLog.splice(0, _callLog.length - MAX_LOG);
  });
  const unsubPost = on('postTool', 'logger', async (tool, args, result) => {
    _callLog.push({ type: 'post', tool, time: Date.now(), resultLength: typeof result === 'string' ? result.length : 0 });
    if (_callLog.length > MAX_LOG) _callLog.splice(0, _callLog.length - MAX_LOG);
  });
  return () => { unsubPre(); unsubPost(); };
}

export function enablePermissionHook(gate) {
  // gate: async (tool, args) => { ok: bool, error?: string }
  if (typeof gate !== 'function') throw new Error('permission hook needs a gate function');
  return on('preTool', 'permission-gate', async (tool, args) => {
    const r = await gate(tool, args);
    if (!r.ok) throw new Error(r.error || 'Permission denied');
  });
}

export function enableRateLimitHook(maxPerMinute = 30) {
  const window = [];
  return on('preTool', 'rate-limit', async () => {
    const now = Date.now();
    while (window.length > 0 && window[0] < now - 60000) window.shift();
    if (window.length >= maxPerMinute) throw new Error(`Rate limit: ${maxPerMinute} tools/min exceeded`);
    window.push(now);
  });
}

export function getCallLog() { return [..._callLog]; }

export function clearCallLog() { _callLog.length = 0; }

export const META = { id: 'hooks-builtin' };
