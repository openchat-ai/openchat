import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { AIPerson, aiPersonRegistry, AI_PERSON_TYPE, createFounder } from '../ai-personhood.js';
import { residentManager } from '../resident-manager.js';
import { persistentConfig } from '../persistent-config.js';
import { ValidatorRegistry, QualityChecker, Corrector, globalValidatorRegistry } from '../quality-check-system.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
    const person = new AIPerson('test-1', '测试AI人', founder.id, AI_PERSON_TYPE.AI_CREATED);

    assert.ok(person);
    assert.strictEqual(person.name, '测试AI人');
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

    // Register listener BEFORE think() — event fires synchronously in Promise constructor
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

  test('QualityChecker integrates external validators', async () => {
    const vr = new ValidatorRegistry();
    vr.register('must_exclaim', async (response) => ({
      passed: response.includes('!'),
      score: response.includes('!') ? 100 : 0,
      reason: response.includes('!') ? 'OK' : '缺少感叹号',
    }));
    const qc = new QualityChecker({ validators: vr });
    const result = await qc.check('Hello world!');
    const extCheck = result.details.find(d => d.name === 'must_exclaim');
    assert.ok(extCheck);
    assert.ok(extCheck.passed);
  });
});
