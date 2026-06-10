// lib/retry-state.mjs — 状态机下沉 (U 假说验证用)
// 假说：复杂任务的脚手架不在 prompt 层，在 tool 层
// 设计：LLM 只调 recordAttempt({ result, error })，状态机自己管
//       LLM 不知道当前 attempt 几次、是否已重试上限、下一步该 throw 还是 resolve

// === invariants ===
// - 同一 retryState 实例只服务一个 operation
// - maxAttempts 严格 > 0
// - recordAttempt({ok:true}) → resolve, recordAttempt({ok:false}) → 决定 retry/threshold
// - threshold 错误不重试 (4xx), transient 错误重试 (5xx/timeout)
// - settle() 必须调一次且仅一次
// - 状态机内部禁止 throw, 全部用 return { type, payload }

export const STATE = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  RETRY: 'retry',
  FAILED: 'failed',
  DONE: 'done',
});

export const ERROR_KIND = Object.freeze({
  TRANSIENT: 'transient',  // 5xx, timeout, network
  THRESHOLD: 'threshold',  // 4xx, 业务校验失败
  FATAL: 'fatal',          // 程序错误, 不应 retry
});

export function create({ maxAttempts = 3, baseDelayMs = 10 } = {}) {
  if (maxAttempts < 1) throw new Error('maxAttempts >= 1');
  const log = [];
  const startMs = Date.now();
  let state = STATE.PENDING;
  let attempts = 0;
  let settled = false;
  let result = null;

  function _log(event, extra = {}) {
    log.push({
      t: Date.now() - startMs,
      state,
      attempt: attempts,
      event,
      ...extra,
    });
  }

  return {
    getState() { return state; },
    getAttempts() { return attempts; },
    getLog() { return log.slice(); },
    getResult() { return result; },

    // LLM 调这个 — tool 把领域知识吃掉了
    recordAttempt({ ok = false, error = null, kind = ERROR_KIND.TRANSIENT, delayMs } = {}) {
      if (settled) return { type: 'already_settled', state, log: log.slice() };
      attempts++;
      state = STATE.RUNNING;
      _log('attempt', { ok, error: error?.message || null, kind });

      if (ok) {
        settled = true;
        state = STATE.DONE;
        result = { ok: true, attempts, totalMs: Date.now() - startMs };
        _log('done');
        return { type: 'done', attempts, totalMs: result.totalMs };
      }

      if (kind === ERROR_KIND.THRESHOLD || kind === ERROR_KIND.FATAL) {
        settled = true;
        state = STATE.FAILED;
        result = { ok: false, attempts, kind, error, totalMs: Date.now() - startMs };
        _log('failed_no_retry');
        return { type: 'failed', reason: kind, attempts, totalMs: result.totalMs };
      }

      if (attempts >= maxAttempts) {
        settled = true;
        state = STATE.FAILED;
        result = { ok: false, attempts, kind, error, totalMs: Date.now() - startMs };
        _log('failed_max_attempts');
        return { type: 'failed', reason: 'max_attempts', attempts, totalMs: result.totalMs };
      }

      state = STATE.RETRY;
      const actualDelay = delayMs ?? baseDelayMs * 2 ** (attempts - 1);
      _log('retry_scheduled', { delayMs: actualDelay });
      return { type: 'retry', attempt: attempts, nextAttempt: attempts + 1, delayMs: actualDelay };
    },

    // 给 LLM 观察 — 不强制用, 但能看到历史
    describe() {
      return {
        state,
        attempts,
        maxAttempts,
        totalMs: Date.now() - startMs,
        lastEvent: log[log.length - 1] || null,
      };
    },
  };
}
