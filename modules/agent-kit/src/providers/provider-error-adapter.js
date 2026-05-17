export class ProviderError extends Error {
  constructor(message, { provider, statusCode, retryable, type }) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
    this.retryable = retryable ?? statusCode >= 500;
    this.type = type || 'unknown';
    this.timestamp = Date.now();
  }
}

export async function withRetry(fn, { retries = 2, baseDelay = 1000, provider } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      const isRetryable = e instanceof ProviderError ? e.retryable : true;
      if (!isRetryable) throw e;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, i)));
    }
  }
}

export function withTimeout(fn, timeoutMs = 15000) {
  return Promise.race([
    fn(),
    new Promise((_, reject) => setTimeout(() => {
      reject(new ProviderError('Provider timeout', { type: 'timeout', retryable: true }));
    }, timeoutMs)),
  ]);
}

export async function safeProviderCall(fn, { provider, retries, timeout } = {}) {
  return withRetry(() => withTimeout(fn, timeout), { retries, provider });
}
