// ErrorTracker — 跨轮次错误追踪 + 重试决策
// 记录每次工具调用的错误，判断是否需要重试
// === invariants ===
// - maxAttemptsPerCall=3，同一 call 超过直接标记 fatal
// - similarError(msg1, msg2): 消息相似度判断，防止绕圈

export function createErrorTracker() {
  const history = []; // { tool, args, error, attempt, round }

  return {
    record(tool, args, error, round) {
      history.push({ tool, args: JSON.stringify(args), error, round, ts: Date.now() });
    },

    // 判断是否可以重试
    shouldRetry(tool, args, error) {
      const argsStr = JSON.stringify(args);
      const attempts = history.filter(h =>
        h.tool === tool &&
        h.args === argsStr &&
        _similarError(h.error, error)
      );
      if (attempts.length >= 3) return { retry: false, reason: '超过最大重试次数 (3)' };
      if (error && _isFatal(error)) return { retry: false, reason: '致命错误，不应重试' };
      return { retry: true, attempt: attempts.length + 1 };
    },

    getHistory() {
      return [...history];
    },

    // 获取最近的同类错误
    getLastSimilar(tool, error) {
      const similar = history.filter(h =>
        h.tool === tool && _similarError(h.error, error)
      );
      return similar[similar.length - 1] || null;
    },

    reset() {
      history.length = 0;
    },
  };
}

function _similarError(a, b) {
  if (!a || !b) return a === b;
  return a.includes(b) || b.includes(a) ||
    a.slice(0, 50) === b.slice(0, 50);
}

function _isFatal(error) {
  const fatals = ['traversal denied', 'permission denied', 'access denied',
    'not supported', 'invalid operation', 'unknown tool'];
  return fatals.some(f => error?.toLowerCase().includes(f));
}
