import { test, describe } from 'node:test';
import assert from 'node:assert';
import { toolRegistry } from '../tool-registry.js';

describe('tool-registry', () => {
  test('list returns 4 default tools', () => {
    const tools = toolRegistry.list();
    assert.strictEqual(tools.length, 4);
    const names = tools.map(t => t.name);
    assert.ok(names.includes('read_memory'));
    assert.ok(names.includes('web_fetch'));
    assert.ok(names.includes('calculate'));
    assert.ok(names.includes('finish'));
  });

  test('get returns named tool', () => {
    const t = toolRegistry.get('calculate');
    assert.ok(t);
    assert.strictEqual(t.name, 'calculate');
  });

  test('get returns undefined for unknown tool', () => {
    assert.strictEqual(toolRegistry.get('nonexistent'), undefined);
  });

  test('call unknown tool returns error', async () => {
    const result = await toolRegistry.call('nonexistent', {});
    assert.ok(result.error);
    assert.ok(result.error.includes('unknown tool'));
  });

  test('call calculate with valid expression', async () => {
    const result = await toolRegistry.call('calculate', { expression: '2 + 3 * 4' });
    assert.strictEqual(result.result, 14);
  });

  test('call calculate with invalid expression returns error', async () => {
    const result = await toolRegistry.call('calculate', { expression: 'process.exit(1)' });
    assert.ok(result.error);
  });

  test('call calculate without expression returns error', async () => {
    const result = await toolRegistry.call('calculate', {});
    assert.ok(result.error);
  });

  test('call finish returns finished flag', async () => {
    const result = await toolRegistry.call('finish', { answer: '42' });
    assert.strictEqual(result.finished, true);
    assert.strictEqual(result.answer, '42');
  });

  test('call read_memory without query returns error', async () => {
    const result = await toolRegistry.call('read_memory', {});
    assert.ok(result.error);
  });

  test('call web_fetch without url returns error', async () => {
    const result = await toolRegistry.call('web_fetch', {});
    assert.ok(result.error);
  });

  test('call web_fetch with localhost blocked', async () => {
    const result = await toolRegistry.call('web_fetch', { url: 'http://localhost:8080/secret' });
    assert.ok(result.error);
    assert.ok(result.error.includes('local') || result.error.includes('blocked'));
  });

  test('call web_fetch with private IP blocked', async () => {
    const result = await toolRegistry.call('web_fetch', { url: 'http://10.0.0.1/admin' });
    assert.ok(result.error);
    assert.ok(result.error.includes('private') || result.error.includes('blocked'));
  });

  test('call web_fetch with invalid URL returns error', async () => {
    const result = await toolRegistry.call('web_fetch', { url: 'not-a-url' });
    assert.ok(result.error);
  });

  test('getSystemPrompt contains tool names', () => {
    const prompt = toolRegistry.getSystemPrompt();
    assert.ok(prompt.includes('read_memory'));
    assert.ok(prompt.includes('web_fetch'));
    assert.ok(prompt.includes('calculate'));
    assert.ok(prompt.includes('finish'));
    assert.ok(prompt.includes('TOOL_CALL'));
  });
});
