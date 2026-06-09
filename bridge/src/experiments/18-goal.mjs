// Experiment 18: Goal — 拆解目标为步骤, 每步调 agent 实验执行
// 两级体系: goal (规划层) → 拆步骤 → 调 agent (执行层, 多轮工具循环)
// Manifest id: goal
// I/O: { description, sessionId? } → { summary, steps: [{action, status, result}], done, failed }

import { create } from './lib/report.mjs';
import { run as composeRun } from './compose.mjs';
import { persistentConfig } from '../core/persistent-config.js';
import { createProvider } from 'provider-kit';
import assert from 'node:assert';

export const META = { id: 'goal' };
const NAME = 'Goal — 拆解目标 + agent 逐步执行';
const MAX_STEPS = 8;

async function _getProvider() {
  const cfg = persistentConfig.config;
  const provider = cfg.current?.provider || Object.keys(cfg.providers || {})[0];
  const model = cfg.current?.model || cfg.providers?.[provider]?.defaultModel;
  const apiKey = cfg.providers?.[provider]?.apiKey;
  if (!apiKey) throw new Error('goal: no apiKey');
  const p = createProvider(provider, apiKey);
  await p.connect(apiKey);
  return { provider: p, model };
}

async function _decompose(description, p, model) {
  const prompt = `Decompose the following goal into ${MAX_STEPS} concrete sequential steps.

Goal: ${description}

Return ONLY a JSON array, no other text:
[{ "action": "...", "expected": "..." }]`;

  const resp = await p.chat(model, [{ role: 'user', content: prompt }]);
  const text = resp.content || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`goal: cannot parse steps: ${text.slice(0, 200)}`);
  const steps = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('goal: no steps returned');
  return steps.slice(0, MAX_STEPS);
}

// compose 契约入口
export async function run({ inputs = {} } = {}) {
  const { description, sessionId = 'default' } = inputs;
  if (!description) throw new Error('goal.run: description required');

  const { provider, model } = await _getProvider();
  const steps = await _decompose(description, provider, model);

  const results = [];
  let done = 0;
  let failed = 0;

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const stepPrompt = `[Goal: ${description}]\nStep ${i + 1}/${steps.length}: ${s.action}\nExpected: ${s.expected}\n\nExecute this step now.`;
    let result = '';
    let status = 'failed';
    try {
      const r = await composeRun('skeleton-agent', { text: stepPrompt, chatId: `${sessionId}/step-${i}` });
      result = r?.response || '';
      if (result) status = 'done';
    } catch (e) {
      result = `[Error] ${e.message}`;
    }
    if (status === 'done') done++;
    else failed++;
    results.push({ action: s.action, expected: s.expected, status, result: result.slice(0, 2000) });
  }

  const summary = `Goal "${description}": ${done}/${results.length} steps done, ${failed} failed.`;
  return { outputs: { summary, steps: results, done, failed, total: results.length } };
}

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


