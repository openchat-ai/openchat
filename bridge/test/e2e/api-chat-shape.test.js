import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('/api/chat response shape', () => {
  let orchestrator, hashlineHash, sm, sid;

  test('setup: inject mock provider + session', async () => {
    const m = await import('../../src/core/runtime.mjs');
    const o = await import('../../src/core/agent/orchestrator.mjs');
    orchestrator = o.orchestrator;
    hashlineHash = o.hashlineHash;
    sm = m.sessionManager;

    sm.providers.set('test-mock', { chat: async () => ({ content: 'Mock response' }) });
    const sess = sm.createSession('test-mock', 'mock-model');
    sid = sess.id;
  });

  test('processStream returns { response, hash } with matching hash', async () => {
    const events = [];
    const result = await orchestrator.processStream(sid, 'test', 'hi', (e) => {
      events.push(e);
    }, sm);

    assert.ok(result);
    assert.strictEqual(result.response, 'Mock response');
    assert.ok(typeof result.hash === 'string' && result.hash.length === 8);

    const completeEvent = events.find(e => e.type === 'complete');
    assert.ok(completeEvent);
    assert.strictEqual(completeEvent.hash, result.hash);
    assert.strictEqual(result.hash, hashlineHash('Mock response'));
  });

  test('process returns { response, hash } with matching hash', async () => {
    const result = await orchestrator.process(sid, 'test', 'hi');

    assert.ok(result);
    assert.strictEqual(result.response, 'Mock response');
    assert.strictEqual(result.hash, hashlineHash('Mock response'));
  });

  test('hashlineHash produces consistent 8-char hex', () => {
    assert.strictEqual(hashlineHash('hello'), '5d41402a');
    assert.strictEqual(hashlineHash(''), 'd41d8cd9');
    assert.strictEqual(hashlineHash('hello').length, 8);
  });
});
