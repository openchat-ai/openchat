// Guardian — 工具调用的守卫层（验证 + 强制 + 追踪）
// 可注入 skeleton-agent 或 dev-repl，作为可选的 guardrails 层
// === invariants ===
// - wrap(tc, executor): 先校验，通过后执行，返回结果字符串
// - validateResponse(response): 校验整个 LLM 响应
// - MAX_REPEAT=3

import { validateResponse } from './response-validator.mjs';
import { createStepEnforcer } from './step-enforcer.mjs';
import { createErrorTracker } from './error-tracker.mjs';

export function createGuardian({ tools, stepDeps = {} } = {}) {
  const enforcer = createStepEnforcer();
  const tracker = createErrorTracker();
  if (Object.keys(stepDeps).length > 0) enforcer.defineAll(stepDeps);
  const callCount = new Map();

  function _parseArgs(tc) {
    const raw = tc.function?.arguments || tc.arguments || '{}';
    try { return { ok: true, args: typeof raw === 'string' ? JSON.parse(raw) : raw }; }
    catch { return { ok: false, error: `[Guardian] 参数非法 JSON: ${String(raw).slice(0, 80)}` }; }
  }

  return {
    // 先校验，再执行。返回 { ok, result/error, bypassedByGuardian? }
    async wrap(tc, executor) {
      const name = tc.function?.name || tc.name;
      const parsed = _parseArgs(tc);
      if (!parsed.ok) return parsed;

      const key = `${name}:${JSON.stringify(parsed.args)}`;
      const cnt = (callCount.get(key) || 0) + 1;
      callCount.set(key, cnt);
      if (cnt > 3) return { ok: false, error: `[Guardian] 循环中止: ${name} 相同参数调用 ${cnt} 次`, bypassedByGuardian: true };

      const check = enforcer.check(name);
      if (!check.ok) return { ok: false, error: `[Guardian] 前置步骤缺失: ${name} 需要先完成 ${check.missing.join(', ')}`, bypassedByGuardian: true };

      try {
        const result = await executor(name, JSON.stringify(parsed.args));
        enforcer.complete(name);
        return { ok: true, result };
      } catch (e) {
        tracker.record(name, parsed.args, e.message, -1);
        return { ok: false, error: `[Error] ${e.message}` };
      }
    },

    // 校验整个 LLM 响应，返回 { valid, toolCalls, errors }
    validateResponse(response) {
      const v = validateResponse(response, tools);
      return v;
    },

    reset() { callCount.clear(); enforcer.reset(); tracker.reset(); },
  };
}
