import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  ProviderError, withRetry, withTimeout, safeProviderCall,
  ProviderManager, providerManager, providerRegistry, createProvider,
} from '../src/index.js';

describe('@openchat/provider-kit', () => {
  test('exports all modules', () => {
    assert.ok(ProviderError);
    assert.ok(typeof withRetry === 'function');
    assert.ok(typeof withTimeout === 'function');
    assert.ok(typeof safeProviderCall === 'function');
    assert.ok(ProviderManager);
    assert.ok(providerManager);
    assert.ok(providerRegistry);
    assert.ok(typeof createProvider === 'function');
  });

  test('ProviderError carries metadata', () => {
    const err = new ProviderError('API error', { provider: 'openai', statusCode: 429, retryable: true, type: 'rate_limit' });
    assert.strictEqual(err.message, 'API error');
    assert.strictEqual(err.provider, 'openai');
    assert.strictEqual(err.statusCode, 429);
    assert.strictEqual(err.retryable, true);
    assert.strictEqual(err.type, 'rate_limit');
  });

  test('withRetry retries on ProviderError', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 2) throw new ProviderError('temporary', { retryable: true });
      return 'ok';
    }, { retries: 2 });
    assert.strictEqual(result, 'ok');
    assert.strictEqual(attempts, 2);
  });

  test('withRetry throws on non-retryable error', async () => {
    await assert.rejects(() => withRetry(async () => {
      throw new ProviderError('permanent', { retryable: false });
    }, { retries: 2 }), ProviderError);
  });

  test('withTimeout rejects on timeout', async () => {
    await assert.rejects(() => withTimeout(async () => {
      await new Promise(r => setTimeout(r, 100));
    }, 10));
  });
});
