/**
 * Minimal agent monitor for @openchat/agent-kit
 * Tracks execution stats in-memory.
 */
export class AgentMonitor {
  constructor() {
    this._executions = new Map();
  }

  recordExecutionStart(agentId, userMessage, context) {
    this._executions.set(agentId, { startTime: Date.now(), userMessage, context, toolCalls: [] });
  }

  recordToolCall(agentId, toolName, args, result) {
    const exec = this._executions.get(agentId);
    if (exec) exec.toolCalls.push({ toolName, args, result, time: Date.now() });
  }

  recordExecutionComplete(agentId, result) {
    const exec = this._executions.get(agentId);
    if (exec) exec.completed = result;
  }

  getStats() {
    const stats = { total: 0, completed: 0, failed: 0 };
    for (const [, exec] of this._executions) {
      stats.total++;
      if (exec.completed) stats.completed++;
      else if (Date.now() - exec.startTime > 300000) stats.failed++;
    }
    return stats;
  }
}

export const agentMonitor = new AgentMonitor();
export default agentMonitor;
