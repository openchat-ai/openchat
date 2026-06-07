// Experiment 19: 编排器 — processStream / process / executeGoal
// Manifest id: orchestrator
// I/O: { mode? } → { response, events }

import { create } from './lib/report.mjs';
import assert from 'node:assert';

export const META = { id: 'orchestrator' };
const NAME = 'Orchestrator — processStream / process / executeGoal';

class MockProvider {
  chat = async () => ({ content: 'mock response', toolCalls: null });
  chatStream = async function*() {
    yield { type: 'content', content: 'mock ' };
    yield { type: 'content', content: 'response' };
  };
}
class MockSessionManager {
  getSession = () => ({ providerType: 'mock', model: 'mock' });
  getProvider = () => new MockProvider();
}
class MockMemoryManager {
  constructor() { this.initialized = true; this.useRAG = false; this._msgs = []; }
  initialize = async () => {};
  addMessage = async (sid, role, msg) => this._msgs.push({ role, msg });
  getContext = async () => this._msgs;
  retrieveRelevantContext = async () => [];
}

export async function test() {
  const R = create();
  const { Orchestrator, OrchestratorEvents } = await import('../core/agent/orchestrator.mjs');
  const { GoalManager } = await import('../core/goal-manager.mjs');

  const sm = new MockSessionManager();
  const mm = new MockMemoryManager();

  // === Orchestrator ===
  const orch = new Orchestrator({
    sessionManager: sm,
    memoryManager: mm,
    PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
    useRAG: false,
    useFunctionCalling: false,
    maxIterations: 1,
  });

  // processStream — streaming callback
  {
    const events = [];
    const result = await orch.processStream('s1', 'u1', 'hello', (e) => events.push(e));
    assert.strictEqual(result, 'mock response');
    assert.ok(events.length >= 2);
    const types = events.map(e => e.type);
    assert.ok(types.includes(OrchestratorEvents.THINKING));
    assert.ok(types.includes(OrchestratorEvents.COMPLETE));
    R.ok('processStream: returns response + emits thinking/complete events');
  }

  // process — non-streaming wrapper
  {
    const mm2 = new MockMemoryManager();
    const orch2 = new Orchestrator({
      sessionManager: sm, memoryManager: mm2,
      PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
      useRAG: false, useFunctionCalling: false, maxIterations: 1,
    });
    const result = await orch2.process('s2', 'u1', 'hello');
    assert.strictEqual(result, 'mock response');
    assert.ok(mm2._msgs.some(m => m.role === 'assistant'));
    R.ok('process: returns response + writes to memory');
  }

  // process — throws on missing session
  {
    const badSm = { getSession: () => null, getProvider: () => null };
    const orch3 = new Orchestrator({
      sessionManager: badSm, memoryManager: new MockMemoryManager(),
      PromptBuilder: { buildSystemPrompt: async () => '' },
      useRAG: false, useFunctionCalling: false,
    });
    try { await orch3.process('no-session', 'u1', 'hi'); assert.fail('should throw'); }
    catch { R.ok('process: throws when session not found'); }
  }

  // executeGoal — goal-driven execution
  {
    class GoalProvider {
      chat = async () => ({
        content: '```json\n[{"id":1,"action":"Step A","expected":"Done"}]\n```',
      });
    }
    const gsm = new (class {
      getSession = () => ({ providerType: 'mock', model: 'mock' });
      getProvider = () => new GoalProvider();
    })();
    const gm = new GoalManager({ sessionManager: gsm });
    const orch4 = new Orchestrator({
      sessionManager: gsm, memoryManager: new MockMemoryManager(),
      goalManager: gm,
      PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
      useRAG: false, useFunctionCalling: false, maxIterations: 1,
    });
    const events = [];
    const result = await orch4.executeGoal('s3', 'u1', 'Do thing', (e) => events.push(e));
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    const types = events.map(e => e.type);
    assert.ok(types.includes('goal_created'));
    assert.ok(types.includes('goal_complete'));
    R.ok('executeGoal: goal_created → ... → goal_complete');
  }

  // _checkAndCorrectResponse
  {
    const qc = new (class { check = async () => ({ passed: true, score: 85, issues: [] }) })();
    const orch5 = new Orchestrator({
      sessionManager: sm, memoryManager: new MockMemoryManager(),
      qualityChecker: qc,
      useRAG: false, useFunctionCalling: false,
    });
    const r = await orch5._checkAndCorrectResponse('good', 's1', 'u1', () => {});
    assert.strictEqual(r, 'good');
    R.ok('_checkAndCorrectResponse: passes through when quality OK');
  }

  R.report(NAME);
}


