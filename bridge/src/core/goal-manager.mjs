import crypto from 'crypto';
import logger from './monitoring/logger.js';

const GOAL_DECOMPOSE_PROMPT = `You are a precise goal decomposer. Break the following goal into concrete, actionable steps.

Goal: {description}

Respond with ONLY a valid JSON array. Each step object:
- "id": sequential number
- "action": what to do (one concise sentence)
- "expected": expected outcome (one sentence)

\`\`\`json
[
  { "id": 1, "action": "Step description", "expected": "Expected outcome" }
]
\`\`\``;

export class GoalManager {
  constructor(options = {}) {
    this.goals = new Map();
    this.evolutionMemory = options.evolutionMemory || null;
    this.sessionManager = options.sessionManager || null;
    this.memoryManager = options.memoryManager || null;
    this.maxStepsPerGoal = options.maxStepsPerGoal || 20;
  }

  createGoal(sessionId, userId, description, context = {}) {
    const id = `goal_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const goal = {
      id, sessionId, userId, description,
      steps: [],
      status: 'active',
      stepIndex: 0,
      context,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.goals.set(id, goal);
    return goal;
  }

  async decomposeGoal(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const sm = this.sessionManager;
    if (!sm) throw new Error('GoalManager: sessionManager required for decompose');
    const session = sm.getSession(goal.sessionId);
    if (!session) throw new Error(`Session ${goal.sessionId} not found`);
    const provider = sm.getProvider(session.providerType);

    const prompt = GOAL_DECOMPOSE_PROMPT.replace('{description}', goal.description);
    const response = await provider.chat(session.model, [
      { role: 'system', content: 'You output ONLY valid JSON. No preamble.' },
      { role: 'user', content: prompt },
    ]);

    const content = response.content || '';
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) throw new Error('Failed to parse decomposed steps from LLM response');

    const raw = JSON.parse(jsonMatch[1] || jsonMatch[0]);
    if (!Array.isArray(raw) || raw.length === 0) throw new Error('Decomposition returned empty step list');

    goal.steps = raw.slice(0, this.maxStepsPerGoal).map(s => ({
      id: s.id,
      action: s.action,
      expected: s.expected || '',
      status: 'pending',
      result: null,
      error: null,
    }));
    goal.updatedAt = Date.now();

    if (this.evolutionMemory) {
      this.evolutionMemory.rememberProgress(`goal:${goalId}`, 'active', {
        description: goal.description,
        steps: goal.steps.map(s => ({ id: s.id, action: s.action, status: s.status })),
        sessionId: goal.sessionId,
      });
    }

    return goal.steps;
  }

  getGoal(goalId) {
    return this.goals.get(goalId);
  }

  getSessionGoals(sessionId) {
    return Array.from(this.goals.values()).filter(g => g.sessionId === sessionId);
  }

  getActiveGoal(sessionId) {
    return this.getSessionGoals(sessionId).find(g => g.status === 'active' || g.status === 'paused');
  }

  async executeNextStep(goalId, execFn, onEvent = () => {}) {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const nextStep = goal.steps.find(s => s.status === 'pending');
    if (!nextStep) {
      goal.status = 'done';
      goal.updatedAt = Date.now();
      onEvent({ type: 'goal_done', goalId, description: goal.description });
      if (this.evolutionMemory) {
        this.evolutionMemory.updateProgress(`goal:${goalId}`, 'done', { completedAt: Date.now() });
      }
      return null;
    }

    nextStep.status = 'in_progress';
    goal.stepIndex = nextStep.id;
    onEvent({ type: 'step_start', goalId, step: { id: nextStep.id, action: nextStep.action } });

    try {
      const result = await execFn(nextStep);
      nextStep.status = 'done';
      nextStep.result = typeof result === 'string' ? result.slice(0, 2000) : JSON.stringify(result).slice(0, 2000);
      onEvent({ type: 'step_done', goalId, step: { id: nextStep.id, action: nextStep.action }, result: nextStep.result });
    } catch (error) {
      nextStep.status = 'failed';
      nextStep.error = error.message;
      goal.status = 'failed';
      onEvent({ type: 'step_failed', goalId, step: { id: nextStep.id, action: nextStep.action }, error: error.message });
      logger.warn(`[GoalManager] Step ${nextStep.id} failed:`, error.message);
    }

    goal.updatedAt = Date.now();

    if (this.evolutionMemory) {
      this.evolutionMemory.updateProgress(`goal:${goalId}`, goal.status, {
        lastStep: nextStep.id,
        lastStepStatus: nextStep.status,
      });
    }

    return nextStep;
  }

  resumeGoal(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) return null;
    if (goal.status === 'done') return null;
    goal.status = 'active';
    goal.updatedAt = Date.now();
    return goal;
  }

  getStatus(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) return null;
    const total = goal.steps.length;
    const done = goal.steps.filter(s => s.status === 'done').length;
    const failed = goal.steps.filter(s => s.status === 'failed').length;
    const pending = goal.steps.filter(s => s.status === 'pending').length;
    return { id: goalId, description: goal.description, status: goal.status, total, done, failed, pending };
  }
}
