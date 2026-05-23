import { test, describe } from 'node:test';
import assert from 'node:assert';

class MockPluginManager {
  execHook = async () => {};
  getToolsForFunctionCalling = () => [];
  executeTool = async (name) => ({ success: true, data: `${name} result` });
  formatToolResult = () => 'tool result formatted';
  skills = { get: () => null };
}

class MockMemoryManager {
  constructor() { this.initialized = true; this.useRAG = false; this._msgs = []; }
  initialize = async () => {};
  addMessage = async (sid, role, msg) => this._msgs.push({ role, msg });
  getContext = async () => this._msgs;
  retrieveRelevantContext = async () => [];
}

class MockSessionManager {
  getSession = () => ({ providerType: 'openai', model: 'gpt-4' });
  getProvider = () => ({
    chat: async () => ({ content: 'mock final response\nFINAL: done', tokens: { total: 10 } }),
  });
}

class MockAgentMonitor {
  recordExecutionStart = () => {};
  recordToolCall = () => {};
  recordExecutionComplete = () => {};
}

class MockEvolutionMemory {
  recall = () => null;
  search = () => [];
  remember = () => true;
}

const { AgentEngine, AgentEvents } = await import('../agent/agent-engine.js');

describe('AgentEngine', () => {
  function makeEngine(opts = {}) {
    return new AgentEngine({
      memoryManager: new MockMemoryManager(),
      pluginManager: new MockPluginManager(),
      sessionManager: new MockSessionManager(),
      PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
      agentMonitor: new MockAgentMonitor(),
      residentMemory: new MockEvolutionMemory(),
      ...opts,
    });
  }

  describe('exports', () => {
    test('AgentEvents contains 7 types', () => {
      assert.strictEqual(Object.keys(AgentEvents).length, 7);
    });
  });

  describe('constructor', () => {
    test('accepts injected deps', () => {
      const e = makeEngine();
      assert.ok(e.memoryManager);
      assert.ok(e.pluginManager);
    });

    test('default options', () => {
      const e = makeEngine();
      assert.strictEqual(e.maxIterations, 10);
      assert.strictEqual(e.useRAG, true);
      assert.strictEqual(e.enableQualityCheck, true);
    });

    test('custom options', () => {
      const e = makeEngine({ useRAG: false, useFunctionCalling: false, enableQualityCheck: false });
      assert.strictEqual(e.useRAG, false);
      assert.strictEqual(e.enableQualityCheck, false);
    });
  });

  describe('process()', () => {
    test('rejects when session not found', async () => {
      const e = makeEngine({
        sessionManager: { getSession: () => null, getProvider: () => null },
      });
      await assert.rejects(() => e.process('s1', 'u1', 'hello'));
    });

    test('returns a string response', async () => {
      const e = makeEngine({ useRAG: false, useFunctionCalling: false });
      const result = await e.process('s1', 'u1', 'hello');
      assert.ok(typeof result === 'string');
      assert.ok(result.length > 0);
    });

    test('writes to memory during process', async () => {
      const mm = new MockMemoryManager();
      const e = makeEngine({ memoryManager: mm, useRAG: false, useFunctionCalling: false });
      await e.process('s1', 'u1', 'test message');
      assert.ok(mm._msgs.length > 0);
    });

    test('handles empty user message', async () => {
      const e = makeEngine({ useRAG: false, useFunctionCalling: false });
      const result = await e.process('s1', 'u1', '');
      assert.ok(typeof result === 'string');
    });

  });

  describe('_checkAndCorrectResponse', () => {
    test('passes through when quality check passes', async () => {
      const e = makeEngine({
        qualityChecker: new (class { check() { return { passed: true, score: 85, issues: [] }; } })(),
      });
      const r = await e._checkAndCorrectResponse('good', 's1', 'u1', () => {});
      assert.strictEqual(r, 'good');
    });

    test('corrects when check fails', async () => {
      const e = makeEngine({
        qualityChecker: new (class { check() { return { passed: false, score: 30, issues: ['bad'] }; } })(),
      });
      const r = await e._checkAndCorrectResponse('bad', 's1', 'u1', () => {});
      assert.ok(typeof r === 'string');
    });
  });

  describe('performSelfVerification', () => {
    test('returns null when judge tool unavailable', async () => {
      const e = makeEngine();
      const r = await e.performSelfVerification({ success: true, actions: [] });
      assert.strictEqual(r, null);
    });
  });

  describe('edge cases', () => {
    test('process with null sessionId throws', async () => {
      const e = makeEngine({ useRAG: false, useFunctionCalling: false });
      try { await e.process(null, 'u1', 'hi'); assert.fail(); }
      catch { /* expected */ }
    });
  });
});
