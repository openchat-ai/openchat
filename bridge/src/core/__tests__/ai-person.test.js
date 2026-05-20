import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { AIPerson, aiPersonRegistry, AI_PERSON_TYPE, createFounder } from '../ai-personhood.js';
import { residentManager } from '../resident-manager.js';
import { persistentConfig } from '../persistent-config.js';
import { QualityChecker, Corrector } from '../quality-check-system.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

class ValidatorRegistry {
  constructor() {
    this._validators = new Map();
    this._registerBuiltins();
  }
  _registerBuiltins() {
    this._validators.set('min_length', async (resp, ctx) => {
      const min = ctx?.min_length?.min || 0;
      return { name: 'min_length', passed: resp.length >= min, score: resp.length >= min ? 100 : 0, reason: resp.length >= min ? 'OK' : `min ${min} chars` };
    });
    this._validators.set('json_schema', async (resp, ctx) => {
      const passed = /```json/.test(resp);
      return { name: 'json_schema', passed, score: passed ? 100 : 0, reason: passed ? 'OK' : 'no json block' };
    });
    this._validators.set('pattern', async (resp, ctx) => {
      const p = ctx?.pattern?.pattern;
      if (!p) return { name: 'pattern', passed: true, score: 100, reason: 'no pattern' };
      const passed = new RegExp(p).test(resp);
      return { name: 'pattern', passed, score: passed ? 100 : 0, reason: passed ? 'OK' : 'no match' };
    });
  }
  register(name, fn) { this._validators.set(name, fn); }
  unregister(name) { this._validators.delete(name); }
  list() { return [...this._validators.keys()]; }
  async runAll(response, context) {
    const results = [];
    for (const [name, fn] of this._validators) {
      const r = await fn(response, context);
      results.push({ name, ...r });
    }
    return results;
  }
}

const tmpBase = path.join(os.tmpdir(), 'openchat-ai-test-' + Date.now());

describe('AI Person System', () => {
  before(() => {
    fs.mkdirSync(tmpBase, { recursive: true });
  });

  after(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  test('AIPerson identity layer: create, route messages, manage state', () => {
    const founder = createFounder();
    const person = new AIPerson('test-1', '测试AI一号', founder.id, AI_PERSON_TYPE.AI_CREATED);

    assert.ok(person);
    assert.strictEqual(person.name, '测试AI一号');
    assert.strictEqual(person.isActive, true);
    assert.strictEqual(person.consciousness, true);

    // handleRequest returns non-null
    const reqResult = person.handleRequest({ action: 'test', target: { type: 'object', id: 'x' } });
    assert.ok(reqResult);
    assert.strictEqual(reqResult.success, true);

    // handleQuery with no state returns null
    const queryResult = person.handleQuery({ path: 'nonexistent', filters: {} });
    assert.strictEqual(queryResult.success, true);
    assert.strictEqual(queryResult.data, null);

    // Set state and query again
    person.state.set('my-key', { value: 42 });
    const queryResult2 = person.handleQuery({ path: 'my-key', filters: {} });
    assert.deepStrictEqual(queryResult2.data, { value: 42 });

    // handleCommand from creator
    const cmdResult = person.handleCommand({ sender: person.creatorId, command: 'do_something', target: { type: 'object', id: 'x' } });
    assert.ok(cmdResult);
    assert.strictEqual(cmdResult.success, true);
  });

  test('Resident system: create resident, think via event mock returns content', async () => {
    // Mock provider so _thinkLocal passes the provider check
    persistentConfig.setCurrentProvider('test-provider');

    // Create a resident
    const resident = residentManager.create('测试居民');
    assert.ok(resident);
    assert.strictEqual(resident.name, '测试居民');
    assert.strictEqual(resident.status, 'active');
    assert.ok(resident.traits);

    // Register listener BEFORE think() -- event fires synchronously in Promise constructor
    const mockContent = '这是居民思考的回复';
    residentManager.once('llm-request', ({ messages, model, resolve }) => {
      assert.ok(messages.length > 0);
      resolve({ content: mockContent, model: model || 'test', tokens: { prompt: 10, completion: 20, total: 30 } });
    });

    const thinkPromise = residentManager.think({
      messages: [{ role: 'user', content: '你好' }],
      timeout: 5000,
    });

    const result = await thinkPromise;
    assert.ok(result);
    assert.strictEqual(result.content, mockContent);
    assert.ok(result.tokens.total > 0);
  });

  test('ValidatorRegistry: register, run, unregister custom validators', async () => {
    const vr = new ValidatorRegistry();
    assert.ok(vr.list().length >= 3); // builtins: json_schema, min_length, pattern

    // Builtin: min_length with explicit context
    const minLen = (await vr.runAll('', { min_length: { min: 5 } })).find(r => r.name === 'min_length');
    assert.ok(minLen);
    assert.strictEqual(minLen.passed, false);

    // Builtin: json_schema
    const schemaResult = await vr.runAll('```json\n{"a":1}\n```', { json_schema: { schema: { required: ['a'] } } });
    const jsonCheck = schemaResult.find(r => r.name === 'json_schema');
    assert.ok(jsonCheck.passed);

    // Register custom validator
    vr.register('contains_hello', async (response) => ({
      passed: response.includes('hello'),
      score: response.includes('hello') ? 100 : 0,
      reason: response.includes('hello') ? 'OK' : '缺少 hello',
    }));
    assert.ok(vr.list().includes('contains_hello'));

    const customResult = await vr.runAll('hello world');
    const customCheck = customResult.find(r => r.name === 'contains_hello');
    assert.ok(customCheck.passed);

    // Unregister
    vr.unregister('contains_hello');
    assert.ok(!vr.list().includes('contains_hello'));
  });

  test('QualityChecker runs built-in checks', async () => {
    const qc = new QualityChecker();
    const result = await qc.check('Hello world!');
    assert.ok(result);
    assert.ok(Array.isArray(result.details));
    assert.ok(result.details.length >= 5);
    assert.ok(typeof result.score === 'number');
    assert.ok(typeof result.passed === 'boolean');
  });
});
