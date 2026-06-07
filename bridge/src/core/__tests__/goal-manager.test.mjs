import { test, describe } from 'node:test';
import assert from 'node:assert';
import { GoalManager } from '../goal-manager.mjs';

class MockSessionManager {
  getSession = () => ({ providerType: 'mock', model: 'mock-model' });
  getProvider = () => ({
    chat: async () => ({ content: '```json\n[{"id":1,"action":"Step one","expected":"Result one"},{"id":2,"action":"Step two","expected":"Result two"}]\n```' }),
  });
}

class MockMemoryManager {
  addMessage = async () => {};
  getContext = async () => [];
}

describe('GoalManager', () => {
  function makeGM(opts = {}) {
    return new GoalManager({
      sessionManager: new MockSessionManager(),
      memoryManager: new MockMemoryManager(),
      ...opts,
    });
  }

  describe('createGoal', () => {
    test('creates goal with correct fields', () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'Build a feature');
      assert.ok(g.id.startsWith('goal_'));
      assert.strictEqual(g.sessionId, 's1');
      assert.strictEqual(g.userId, 'u1');
      assert.strictEqual(g.description, 'Build a feature');
      assert.strictEqual(g.status, 'active');
      assert.strictEqual(g.steps.length, 0);
    });

    test('multiple goals have unique IDs', () => {
      const gm = makeGM();
      const a = gm.createGoal('s1', 'u1', 'A');
      const b = gm.createGoal('s1', 'u1', 'B');
      assert.notStrictEqual(a.id, b.id);
    });
  });

  describe('getGoal / getSessionGoals', () => {
    test('returns goal by ID', () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'test');
      assert.strictEqual(gm.getGoal(g.id), g);
    });

    test('returns undefined for unknown ID', () => {
      const gm = makeGM();
      assert.strictEqual(gm.getGoal('nope'), undefined);
    });

    test('lists goals for a session', () => {
      const gm = makeGM();
      gm.createGoal('s1', 'u1', 'A');
      gm.createGoal('s2', 'u1', 'B');
      gm.createGoal('s1', 'u1', 'C');
      assert.strictEqual(gm.getSessionGoals('s1').length, 2);
      assert.strictEqual(gm.getSessionGoals('s2').length, 1);
    });
  });

  describe('getActiveGoal', () => {
    test('returns active goal', () => {
      const gm = makeGM();
      gm.createGoal('s1', 'u1', 'A');
      const active = gm.getActiveGoal('s1');
      assert.ok(active);
      assert.strictEqual(active.description, 'A');
    });

    test('returns null when none active', () => {
      const gm = makeGM();
      assert.strictEqual(gm.getActiveGoal('s1'), undefined);
    });
  });

  describe('decomposeGoal', () => {
    test('decomposes into steps via LLM', async () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'Test goal');
      const steps = await gm.decomposeGoal(g.id);
      assert.ok(Array.isArray(steps));
      assert.strictEqual(steps.length, 2);
      assert.strictEqual(steps[0].id, 1);
      assert.strictEqual(steps[0].status, 'pending');
      assert.strictEqual(steps[1].action, 'Step two');
    });

    test('throws if sessionManager missing', async () => {
      const gm = new GoalManager();
      const g = gm.createGoal('s1', 'u1', 'test');
      await assert.rejects(() => gm.decomposeGoal(g.id));
    });
  });

  describe('executeNextStep', () => {
    test('executes pending step via execFn', async () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'test');
      await gm.decomposeGoal(g.id);
      const events = [];
      const step = await gm.executeNextStep(g.id, async () => 'done', (e) => events.push(e));
      assert.ok(step);
      assert.strictEqual(step.status, 'done');
      assert.strictEqual(step.result, 'done');
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].type, 'step_start');
      assert.strictEqual(events[1].type, 'step_done');
    });

    test('returns null when no pending steps (goal done)', async () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'test');
      const result = await gm.executeNextStep(g.id, async () => 'x');
      assert.strictEqual(result, null);
      assert.strictEqual(g.status, 'done');
    });

    test('marks step failed on execFn error', async () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'test');
      await gm.decomposeGoal(g.id);
      const step = await gm.executeNextStep(g.id, async () => { throw new Error('oops'); });
      assert.strictEqual(step.status, 'failed');
      assert.strictEqual(step.error, 'oops');
      assert.strictEqual(g.status, 'failed');
    });
  });

  describe('resumeGoal', () => {
    test('resumes paused/active goal', () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'test');
      g.status = 'paused';
      const resumed = gm.resumeGoal(g.id);
      assert.ok(resumed);
      assert.strictEqual(resumed.status, 'active');
    });

    test('returns null for done goal', () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'test');
      g.status = 'done';
      assert.strictEqual(gm.resumeGoal(g.id), null);
    });
  });

  describe('getStatus', () => {
    test('returns correct stats', () => {
      const gm = makeGM();
      const g = gm.createGoal('s1', 'u1', 'test');
      g.steps = [
        { id: 1, status: 'done' },
        { id: 2, status: 'pending' },
        { id: 3, status: 'failed' },
      ];
      const s = gm.getStatus(g.id);
      assert.strictEqual(s.total, 3);
      assert.strictEqual(s.done, 1);
      assert.strictEqual(s.pending, 1);
      assert.strictEqual(s.failed, 1);
    });
  });
});

const { Orchestrator } = await import('../agent/orchestrator.mjs');

describe('Orchestrator.executeGoal', () => {
  function makeOrch(opts = {}) {
    const sm = new MockSessionManager();
    const gm = new GoalManager({ sessionManager: sm, ...opts.goalManagerOptions });
    return new Orchestrator({
      sessionManager: sm,
      memoryManager: new MockMemoryManager(),
      PromptBuilder: { buildSystemPrompt: async () => 'You are an AI assistant' },
      goalManager: gm,
      useRAG: false,
      useFunctionCalling: false,
      maxIterations: 1,
      ...opts,
    });
  }

  test('executes a goal end-to-end', async () => {
    const orch = makeOrch();
    const events = [];
    const result = await orch.executeGoal('s1', 'u1', 'Test goal', (e) => events.push(e));
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    const types = events.map(e => e.type);
    assert.ok(types.includes('goal_created'));
    assert.ok(types.includes('goal_decompose'));
    assert.ok(types.includes('goal_decomposed'));
    assert.ok(types.includes('goal_complete'));
  });

  test('resumes existing active goal', async () => {
    const gm = new GoalManager({ sessionManager: new MockSessionManager() });
    const g = gm.createGoal('s2', 'u1', 'Resume goal');
    await gm.decomposeGoal(g.id);
    const orch = makeOrch({ goalManager: gm });
    const events = [];
    await orch.executeGoal('s2', 'u1', 'Resume goal', (e) => events.push(e));
    const types = events.map(e => e.type);
    assert.ok(types.includes('goal_resume'), 'Should emit goal_resume');
  });

  test('returns summary when all steps done', async () => {
    const orch = makeOrch();
    const result = await orch.executeGoal('s1', 'u1', 'Short goal');
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
  });
});
