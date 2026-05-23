import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

describe('circuit breaker pattern', () => {
  class CircuitBreaker {
    constructor(opts = {}) {
      this.failureThreshold = opts.failureThreshold || 5;
      this.resetTimeout = opts.resetTimeout || 30000;
      this.failures = 0;
      this.state = 'closed';
      this.lastFailureTime = 0;
    }

    async call(fn) {
      if (this.state === 'open') {
        if (Date.now() - this.lastFailureTime >= this.resetTimeout) {
          this.state = 'half-open';
        } else {
          throw new Error('circuit breaker is open');
        }
      }
      try {
        const result = await fn();
        if (this.state === 'half-open') {
          this.state = 'closed';
          this.failures = 0;
        }
        return result;
      } catch (e) {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.failureThreshold) {
          this.state = 'open';
        }
        throw e;
      }
    }

    getState() { return this.state; }
    getFailureCount() { return this.failures; }
    reset() { this.failures = 0; this.state = 'closed'; }
  }

  test('starts closed', () => {
    const cb = new CircuitBreaker();
    assert.strictEqual(cb.getState(), 'closed');
  });

  test('opens after threshold failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 5000 });
    const failingFn = async () => { throw new Error('fail'); };

    for (let i = 0; i < 3; i++) {
      await assert.rejects(() => cb.call(failingFn));
    }
    assert.strictEqual(cb.getState(), 'open');
    assert.strictEqual(cb.getFailureCount(), 3);
  });

  test('blocks calls when open', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50000 });
    await assert.rejects(() => cb.call(async () => { throw new Error('fail'); }));
    assert.strictEqual(cb.getState(), 'open');
    await assert.rejects(() => cb.call(async () => 'ok'), /circuit breaker is open/);
  });

  test('transitions to half-open after reset timeout', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 50 });
    await assert.rejects(() => cb.call(async () => { throw new Error('fail'); }));
    assert.strictEqual(cb.getState(), 'open');
    await new Promise(r => setTimeout(r, 60));
    await cb.call(async () => 'ok');
    assert.strictEqual(cb.getState(), 'closed');
  });

  test('reset clears state', () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    cb.failures = 5;
    cb.state = 'open';
    cb.reset();
    assert.strictEqual(cb.getState(), 'closed');
    assert.strictEqual(cb.getFailureCount(), 0);
  });
});
