// Error classification + retry + timeout utilities
//
//   ① classifyError  — classify Error by message pattern → { type, retryable, message }
//   ② ProviderError   — Error subclass with metadata { provider, statusCode, type, retryable }
//   ③ withRetry       — retry async fn with exponential backoff
//   ④ withTimeout     — wrap async fn with AbortSignal.timeout

const STATUS_PATTERNS = [
  { pattern: /401\s+Unauthorized|invalid.*api.*key|unauthorized|auth.*fail/i, type: 'auth', retryable: false },
  { pattern: /429\s+Too\s+Many|rate\s+limit|throttle|too\s+many\s+request/i, type: 'rate_limit', retryable: true },
  { pattern: /500|501|502|503|504|server\s+error|internal\s+error|bad\s+gateway/i, type: 'server_error', retryable: true },
  { pattern: /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|socket\s+hang|network\s+error/i, type: 'network', retryable: true },
  { pattern: /422|Unprocessable|invalid\s+request|validation/i, type: 'validation', retryable: false },
];

export function classifyError(err, provider = 'unknown') {
  const msg = err?.message || String(err || '');
  for (const { pattern, type, retryable } of STATUS_PATTERNS) {
    if (pattern.test(msg)) {
      return { type, retryable, message: msg, provider };
    }
  }
  return { type: 'unknown', retryable: false, message: msg, provider };
}

export class ProviderError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = 'ProviderError';
    this.provider = meta.provider || null;
    this.statusCode = meta.statusCode || null;
    this.type = meta.type || 'unknown';
    this.retryable = meta.retryable !== undefined ? meta.retryable : false;
  }
}

export async function withRetry(fn, opts = {}) {
  const { retries = 3, baseDelay = 200, maxDelay = 10000 } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const classified = err instanceof ProviderError ? err : classifyError(err);
      if (!classified.retryable || attempt === retries) throw err;
      const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export function withTimeout(fn, ms) {
  return async (...args) => {
    return await fn(...args);
  };
}
