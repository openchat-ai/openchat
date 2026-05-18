import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { residentManager } from '../resident-manager.js';
import { EvolutionMemory } from '../evolution-memory.js';
import { persistentConfig } from '../persistent-config.js';

describe('resident integration', () => {
  const memory = new EvolutionMemory();

  test('create resident with custom ID', () => {
    const r = residentManager.create('测试居民', { id: 'uuid-test-123', traits: { diligence: 0.9 } });
    assert.strictEqual(r.name, '测试居民');
    assert.strictEqual(r.id, 'uuid-test-123');
    assert.strictEqual(r.status, 'active');
  });

  test('get resident by custom ID', () => {
    const r = residentManager.get('uuid-test-123');
    assert.ok(r);
    assert.strictEqual(r.name, '测试居民');
  });

  test('memory remember and recall', () => {
    memory.remember('user_preference_coffee', 'likes dark roast', { scope: 'uuid-test-123' });
    const result = memory.recall('uuid-test-123:user_preference_coffee');
    assert.ok(result);
    assert.strictEqual(result.value, 'likes dark roast');
  });

  test('memory search with scope isolation', () => {
    memory.remember('test_key', 'resident A data', { scope: 'uuid-a' });
    memory.remember('test_key', 'resident B data', { scope: 'uuid-b' });
    const resultsA = memory.search('test_key', { scope: 'uuid-a' });
    assert.strictEqual(resultsA.length, 1);
    assert.ok(resultsA[0].value.includes('resident A'));
  });

  test('resident think via event mock', async () => {
    persistentConfig.setCurrentProvider('test-provider');
    residentManager.setMaxListeners(20);
    residentManager.once('llm-request', ({ messages, resolve }) => {
      assert.ok(messages.length > 0);
      resolve({ content: 'hello back', model: 'test', tokens: { total: 5 } });
    });
    const result = await residentManager.think({
      messages: [{ role: 'user', content: 'The meaning of life is?' }],
      residentId: 'uuid-test-123',
      timeout: 5000,
      useMultiPath: false,
    });
    assert.ok(result);
    assert.strictEqual(result.content, 'hello back');
  });

  test('resident multi-path reasoning', async () => {
    persistentConfig.setCurrentProvider('test-provider');
    residentManager.setMaxListeners(20);
    residentManager.once('llm-request', ({ resolve }) => {
      resolve({ content: '=== 思路 1：基础分析\n分析：最简单的方式\n方案：方案A\n\n=== 思路 2：深入\n分析：更全面\n方案：方案B\n\n=== 选择结果 ===\n最佳思路：1\n理由：最简单', model: 'test' });
    });
    const result = await residentManager.think({
      messages: [{ role: 'user', content: 'solve X' }],
      residentId: 'uuid-test-123',
      timeout: 5000,
    });
    assert.ok(result);
    assert.ok(result.content.includes('基础分析'));
  });

  after(() => {
    residentManager.delete('uuid-test-123');
    memory.forget('uuid-test-123:user_preference_coffee');
    memory.forget('uuid-test-123:test_key');
  });
});
