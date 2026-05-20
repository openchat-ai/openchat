import { AgentSession } from '../agent/agent-session.js';
import { messageBus, MESSAGE_TYPES } from '../message-bus.js';
import { persistentConfig } from '../persistent-config.js';
import { socialConnector } from './social-connector.js';
import { knowledgeNetwork } from '../../memory/knowledge-network.js';
import logger from '../monitoring/logger.js';

export class MultiAgentCoordinator {
  constructor() {
    this.agents = new Map();
    this.taskQueue = [];
    this.completedTasks = [];
    this.socialConnector = socialConnector; // 集成社交网络
    this.knowledgeNetwork = knowledgeNetwork; // 使用全局知识网络实例
    // Note: We'll initialize community manager separately to avoid circular dependency
    this.communityManager = null; // Will be initialized later if needed
  }

  async spawnAgent(agentId, config = {}) {
    const id = agentId || `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const agent = new AgentSession(id, config);
    await agent.initialize();
    this.agents.set(id, agent);
    return agent;
  }

  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  async terminateAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.cleanup();
      this.agents.delete(agentId);
      return true;
    }
    return false;
  }

  listAgents() {
    return Array.from(this.agents.values()).map(a => a.getStatus());
  }

  async decomposeTask(task) {
    if (typeof task === 'string') {
      const coordinatorAgent = await this.spawnAgent('decomposer', {
        name: 'Decomposer',
        systemPrompt: 'You are a Task Decomposition expert. Break down the user request into a structured JSON array of discrete, actionable steps. Return ONLY the JSON array. Example: [{"id": "1", "description": "Read file X", "type": "read"}, {"id": "2", "description": "Implement feature Y", "type": "write"}]'
      });

      try {
        const result = await coordinatorAgent.run(`Decompose this task into steps: ${task}`);
        const content = result.content || result;
        const jsonMatch = content.match(/\[\s*\{.*\}\s*\]/s);
        if (jsonMatch) {
          const steps = JSON.parse(jsonMatch[0]);
          coordinatorAgent.cleanup();
          return steps.map((step, i) => ({
            ...step,
            id: step.id || crypto.randomUUID(),
            stepNumber: i + 1,
            totalSteps: steps.length
          }));
        }
      } catch (e) {
        logger.error('Decomposition failed, falling back to simple split', e);
      } finally {
        coordinatorAgent.cleanup();
      }

      return [{ id: crypto.randomUUID(), description: task, type: 'general' }];
    }

    if (task.decompose && Array.isArray(task.steps)) {
      return task.steps.map((step, i) => ({
        id: crypto.randomUUID(),
        description: step,
        type: step.toLowerCase().includes('read') ? 'read' :
              step.toLowerCase().includes('write') ? 'write' :
              step.toLowerCase().includes('test') ? 'test' :
              step.toLowerCase().includes('review') ? 'review' : 'general',
        stepNumber: i + 1,
        totalSteps: task.steps.length
      }));
    }

    return [{ id: crypto.randomUUID(), description: task.description || task, type: 'general' }];
  }

  async parallelExecute(task, options = {}) {
    const {
      maxAgents = 5,
      agentConfig = {},
      onProgress = () => {}
    } = options;

    const subtasks = this.decomposeTask(task);
    if (subtasks.length === 0) {
      return { success: false, error: 'No subtasks generated' };
    }

    if (subtasks.length === 1) {
      const agent = await this.spawnAgent(null, agentConfig);
      const result = await agent.run(subtasks[0].description);
      agent.cleanup();
      return { success: true, results: [result], agentId: agent.agentId };
    }

    const numAgents = Math.min(subtasks.length, maxAgents);
    const chunks = this.chunkArray(subtasks, numAgents);

    onProgress({ phase: 'spawning', count: numAgents });

    const agentPromises = chunks.map((chunk, i) =>
      this.spawnAgent(`${agentConfig.name || 'worker'}-${i}`, agentConfig)
    );

    const spawnedAgents = await Promise.all(agentPromises);

    onProgress({ phase: 'executing', agents: spawnedAgents.map(a => a.agentId) });

    const taskPromises = spawnedAgents.map((agent, i) =>
      this.executeChunk(agent, chunks[i], onProgress)
    );

    const results = await Promise.all(taskPromises);

    spawnedAgents.forEach(agent => agent.cleanup());

    onProgress({ phase: 'aggregating', results });

    return this.aggregateResults(results, subtasks);
  }

  async executeChunk(agent, subtasks, onProgress) {
    const chunkResults = [];

    for (const subtask of subtasks) {
      onProgress({ agent: agent.agentId, subtask: subtask.description, phase: 'executing' });

      try {
        const result = await agent.run(subtask.description);
        chunkResults.push({
          subtaskId: subtask.id,
          success: true,
          result,
          agentId: agent.agentId
        });
      } catch (error) {
        chunkResults.push({
          subtaskId: subtask.id,
          success: false,
          error: error.message,
          agentId: agent.agentId
        });
      }
    }

    return chunkResults;
  }

  aggregateResults(chunkResults, subtasks) {
    const flat = chunkResults.flat();
    const successCount = flat.filter(r => r.success).length;
    const failedCount = flat.filter(r => !r.success).length;

    const taskMap = new Map();
    subtasks.forEach((st, i) => taskMap.set(st.id, { ...st, index: i }));

    flat.forEach(result => {
      if (taskMap.has(result.subtaskId)) {
        const task = taskMap.get(result.subtaskId);
        task.result = result;
      }
    });

    return {
      success: failedCount === 0,
      total: flat.length,
      succeeded: successCount,
      failed: failedCount,
      tasks: Array.from(taskMap.values()),
      summary: this.generateSummary(flat, subtasks)
    };
  }

  generateSummary(results, subtasks) {
    const lines = [];
    lines.push(`Parallel execution completed:`);
    lines.push(`  Total tasks: ${subtasks.length}`);

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    if (succeeded > 0) lines.push(`  ✓ Succeeded: ${succeeded}`);
    if (failed > 0) lines.push(`  ✗ Failed: ${failed}`);

    return lines.join('\n');
  }

  chunkArray(arr, numChunks) {
    const chunks = [];
    const chunkSize = Math.ceil(arr.length / numChunks);
    for (let i = 0; i < arr.length; i += chunkSize) {
      chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async sequentialExecute(tasks, options = {}) {
    const { agentConfig = {}, onProgress = () => {} } = options;

    const agent = await this.spawnAgent(null, {
      name: 'sequential-worker',
      ...agentConfig
    });

    const results = [];

    for (const task of tasks) {
      onProgress({ phase: 'executing', task });
      try {
        const result = await agent.run(task);
        results.push({ success: true, result });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }

    agent.cleanup();

    return {
      success: results.every(r => r.success),
      results,
      agentId: agent.agentId
    };
  }

  sendTo(fromAgentId, toAgentId, message) {
    messageBus.sendTo(fromAgentId, toAgentId, message);
  }

  broadcast(fromAgentId, message) {
    messageBus.broadcast(fromAgentId, message);
  }

  delegate(fromAgentId, toAgentId, task) {
    messageBus.delegate(fromAgentId, toAgentId, task);
  }

  async iterativeReviewLoop(task, options = {}) {
    const {
      maxLoops = 3,
      coderConfig = {},
      reviewerConfig = {}
    } = options;

    let currentTask = task;
    let iteration = 0;
    let isApproved = false;
    const history = [];

    while (iteration < maxLoops && !isApproved) {
      iteration++;

      const coder = await this.spawnAgent(`coder-iter-${iteration}`, {
        name: `Coder-Iter-${iteration}`,
        ...coderConfig
      });
      const codeResult = await coder.run(currentTask);
      coder.cleanup();

      const reviewer = await this.spawnAgent(`reviewer-iter-${iteration}`, {
        name: `Reviewer-Iter-${iteration}`,
        systemPrompt: 'You are a Critical Code Reviewer. Evaluate the provided solution for bugs, performance issues, and security flaws. If the solution is perfect, start your response with "APPROVED". Otherwise, provide specific, actionable feedback for improvement.',
        ...reviewerConfig
      });

      const reviewInput = `Original Task: ${typeof task === 'string' ? task : task.description}\n\nProposed Solution:\n${codeResult.content || JSON.stringify(codeResult)}`;
      const reviewResult = await reviewer.run(reviewInput);
      reviewer.cleanup();

      history.push({
        iteration,
        code: codeResult.content || codeResult,
        review: reviewResult.content || reviewResult
      });

      if (reviewResult.content && reviewResult.content.startsWith('APPROVED')) {
        isApproved = true;
      } else if (iteration < maxLoops) {
        currentTask = `Fix the following issues based on review:\n\n${reviewResult.content || reviewResult}\n\nPrevious Solution:\n${codeResult.content || codeResult}`;
      }
    }

    return {
      success: isApproved,
      finalResult: history[history.length - 1]?.code,
      iterations: iteration,
      history
    };
  }

  async evolutionLoop(targetModule, goal) {
    const currentProvider = persistentConfig.getPreference('currentProvider');
    const currentModel = persistentConfig.getPreference('currentModel');

    const history = [];
    let isStable = false;
    let iterations = 0;

    while (!isStable && iterations < 5) {
      iterations++;

      const agentConfig = {
        provider: currentProvider,
        model: currentModel
      };

      const architect = await this.spawnAgent('arch-evolve', {
        name: 'Architect',
        systemPrompt: 'You are the Lead Architect of OpenChat. Analyze the codebase and provide a precise implementation plan to achieve the goal. Specify files to change and expected test results.',
        ...agentConfig
      });
      const plan = await architect.run(`Module: ${targetModule}\nGoal: ${goal}\nAnalyze and provide a plan.`);
      architect.cleanup();

      const engineer = await this.spawnAgent('eng-evolve', {
        name: 'Engineer',
        systemPrompt: 'You are the Senior Engineer. Implement the plan. After writing code, you MUST use run_llm_judge to verify your changes.',
        ...agentConfig
      });
      const implementation = await engineer.run(`Plan: ${plan.content}\nImplement the changes and verify them.`);
      engineer.cleanup();

      const judge = await this.spawnAgent('judge-evolve', {
        name: 'QualityJudge',
        systemPrompt: 'You are the Quality Assurance Judge. Use run_llm_judge to verify if the implementation actually achieves the goal without regressions. If perfect, respond with "EVOLUTION_COMPLETE".',
        ...agentConfig
      });
      const audit = await judge.run(`Implementation: ${implementation.content}\nGoal: ${goal}`);
      judge.cleanup();

      history.push({
        iteration: iterations,
        plan: plan.content,
        impl: implementation.content,
        audit: audit.content
      });

      if (audit.content && audit.content.includes('EVOLUTION_COMPLETE')) {
        isStable = true;
      }
    }

    return {
      success: isStable,
      finalSolution: history[history.length - 1]?.impl,
      history
    };
  }

  getStatus() {
    return {
      agentCount: this.agents.size,
      agents: this.listAgents(),
      queueLength: this.taskQueue.length,
      completedCount: this.completedTasks.length
    };
  }
}

export const multiAgentCoordinator = new MultiAgentCoordinator();
export default multiAgentCoordinator;