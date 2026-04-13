import { AgentSession } from './agent-session.js';
import { messageBus, MESSAGE_TYPES } from './message-bus.js';
import { persistentConfig } from '../memory/persistent-config.js';

export class MultiAgentCoordinator {
  constructor() {
    this.agents = new Map();
    this.taskQueue = [];
    this.completedTasks = [];
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

  decomposeTask(task) {
    if (typeof task === 'string') {
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