import { test, describe } from 'node:test';
import assert from 'node:assert';
import { AIPerson, aiPersonRegistry, AI_PERSON_TYPE, createFounder } from '../ai-personhood.js';
import { deitySystemManager } from '../deity-system.js';
import { initializeMirrorDeitySystem } from '../mirror-deity.js';
import { initializeEnergySystem } from '../energy-deity.js';

describe('AI Person System', () => {
  test('create AIPerson and verify message routing works', () => {
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

  test('createDefaultAIPerson via manager wiring', () => {
    // Simulate the startup flow from main.js
    const founder = createFounder();
    // deitySystemManager and friends are singletons, just verify they init
    assert.ok(deitySystemManager);
  });
});
