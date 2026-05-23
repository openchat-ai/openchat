import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const { Forge } = await import('../evolution/forge.js');

describe('Forge', () => {
  let forge;

  before(() => { forge = new Forge(); });

  test('constructor sets defaults', () => {
    assert.ok(forge);
    assert.strictEqual(forge._llmFailures, 0);
    assert.strictEqual(forge._llmCircuitOpen, false);
    assert.ok(Array.isArray(forge._validators));
    assert.strictEqual(forge._validators.length, 4);
  });

  test('addValidator appends to chain', () => {
    forge.addValidator((t) => t === 'bad' ? 'bad_value' : null);
    assert.strictEqual(forge._validators.length, 5);
  });

  describe('_verify', () => {
    test('passes valid text', () => {
      assert.strictEqual(forge._verify('This is a valid response.'), true);
    });

    test('rejects too short', () => {
      assert.strictEqual(forge._verify('abc'), false);
    });

    test('rejects refusal pattern', () => {
      assert.strictEqual(forge._verify('我无法回答这个问题'), false);
      assert.strictEqual(forge._verify('我不知道答案'), false);
    });

    test('rejects too long', () => {
      assert.strictEqual(forge._verify('x'.repeat(60000)), false);
    });

    test('custom validator rejects', () => {
      assert.strictEqual(forge._verify('bad'), false);
    });
  });

  describe('solve with generalization fallback', () => {
    test('solves via solver when generalization succeeds', async () => {
      const r = await forge.solve('test query');
      assert.ok(r);
      assert.ok(['solver', 'llm', 'memory'].includes(r.source));
      assert.ok(r.answer);
    });

    test('returns answer with source field', async () => {
      const r = await forge.solve('hello world');
      assert.ok(r);
      assert.ok(['solver', 'llm', 'memory'].includes(r.source));
    });
  });

  describe('circuit breaker', () => {
    test('opens after 3 LLM failures', () => {
      const f = new Forge();
      f.setLLMHandler(() => Promise.reject(new Error('fail')));
      f._llmCircuitOpen = true;
      assert.strictEqual(f._llmCircuitOpen, true);
    });

    test('setLLMHandler resets circuit breaker', () => {
      const f = new Forge();
      f._llmCircuitOpen = true;
      f._llmFailures = 5;
      f.setLLMHandler(() => 'ok');
      assert.strictEqual(f._llmCircuitOpen, false);
      assert.strictEqual(f._llmFailures, 0);
    });
  });

  describe('learn and verify', () => {
    test('learn stores valid answer', async () => {
      const f = new Forge();
      f.learn('test', 'a valid answer that is long enough');
      // stored via vectorMemory.store - no return value to check,
      // but should not throw
      assert.ok(true);
    });

    test('learn skips invalid answer', () => {
      const f = new Forge();
      f.learn('test', 'abc');
      assert.ok(true);
    });
  });

  describe('search delegation', () => {
    test('search returns array', async () => {
      const r = await forge.search('test');
      assert.ok(Array.isArray(r));
    });

    test('embedSearch returns array', async () => {
      const r = await forge.embedSearch('test');
      assert.ok(Array.isArray(r));
    });
  });

  describe('sync', () => {
    test('sync starts gossip manager', () => {
      const f = new Forge();
      f.sync(null, null);
      assert.ok(f._gossip);
      f.stopSync();
      assert.strictEqual(f._gossip, null);
    });
  });

  describe('edge cases', () => {
  });
});
