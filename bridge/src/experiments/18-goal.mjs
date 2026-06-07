// Experiment 18: GoalManager — goal lifecycle + Orchestrator.executeGoal
// Manifest id: goal
// I/O: { description, sessionId? } → { result, events }

import { create } from './lib/report.mjs';
import assert from 'node:assert';

export const META = { id: 'goal' };
const NAME = 'Goal — goal lifecycle + executeGoal';

export async function test() {
  const R = create();

  const { GoalManager } = await import('../core/goal-manager.mjs');
  const { Orchestrator } = await import('../core/agent/orchestrator.mjs');

  class MockProvider {
    chat = async () => ({
      content: '```json\n[{"id":1,"action":"Analyze","expected":"Done"},{"id":2,"action":"Implement","expected":"Done"}]\n```',
    });
  }
  class MockSessionManager {
    getSession = () => ({ providerType: 'mock', model: 'mock' });
    getProvider = () => new MockProvider();
  }
  class MockMemoryManager {
    addMessage = async () => {};
    getContext = async () => [];
  }
  const sm = new MockSessionManager();

  // === GoalManager unit tests ===
  {
    const gm = new GoalManager({ sessionManager: sm });
    const g = gm.createGoal('s1', 'u1', 'Build feature');
    assert.ok(g.id.startsWith('goal_'));
    assert.strictEqual(g.description, 'Build feature');
    R.ok('createGoal works');

    const steps = await gm.decomposeGoal(g.id);
    assert.strictEqual(steps.length, 2);
    assert.strictEqual(steps[0].status, 'pending');
    R.ok('decomposeGoal returns 2 steps');

    const s1 = await gm.executeNextStep(g.id, async () => 'step1');
    assert.strictEqual(s1.status, 'done');
    assert.strictEqual(s1.result, 'step1');
    R.ok('executeNextStep runs step to done');

    const s2 = await gm.executeNextStep(g.id, async () => 'x', () => {});
    assert.strictEqual(s2.status, 'done');
    const done = await gm.executeNextStep(g.id, async () => 'x', () => {});
    assert.strictEqual(done, null);
    assert.strictEqual(g.status, 'done');
    R.ok('all steps done → goal status=done');

    const g2 = gm.createGoal('s2', 'u1', 'Paused');
    g2.status = 'paused';
    const r = gm.resumeGoal(g2.id);
    assert.ok(r);
    assert.strictEqual(r.status, 'active');
    R.ok('resumeGoal sets status=active');

    const s = gm.getStatus(g.id);
    assert.strictEqual(s.done, 2);
    assert.strictEqual(s.total, 2);
    R.ok('getStatus returns correct stats');

    const g3 = gm.createGoal('s3', 'u1', 'Failing');
    await gm.decomposeGoal(g3.id);
    const failStep = await gm.executeNextStep(g3.id, async () => { throw new Error('boom'); });
    assert.strictEqual(failStep.status, 'failed');
    assert.strictEqual(failStep.error, 'boom');
    assert.strictEqual(g3.status, 'failed');
    R.ok('error in step → status=failed');
  }

  // === Orchestrator.executeGoal integration ===
  {
    const gm = new GoalManager({ sessionManager: sm });
    const orch = new Orchestrator({
      sessionManager: sm,
      memoryManager: new MockMemoryManager(),
      goalManager: gm,
      PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
      useRAG: false,
      useFunctionCalling: false,
      maxIterations: 1,
    });

    const events = [];
    const result = await orch.executeGoal('s4', 'u1', 'Test', (e) => events.push(e));
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    R.ok('executeGoal returns non-empty string');

    const types = events.map(e => e.type);
    assert.ok(types.includes('goal_created'));
    assert.ok(types.includes('goal_decompose'));
    assert.ok(types.includes('goal_decomposed'));
    assert.ok(types.includes('goal_complete'));
    R.ok('events: goal_created → goal_decompose → goal_decomposed → goal_complete');

    const g = gm.createGoal('s5', 'u1', 'Resume');
    await gm.decomposeGoal(g.id);
    const ev2 = [];
    await orch.executeGoal('s5', 'u1', 'Resume', (e) => ev2.push(e));
    assert.ok(ev2.map(e => e.type).includes('goal_resume'));
    R.ok('resume emits goal_resume event');
  }

  R.report(NAME);
}


