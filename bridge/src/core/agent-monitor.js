import { messageBus, MESSAGE_TYPES } from './message-bus.js';
import { AGENT_STATES } from './agent-session.js';
import fs from 'fs/promises';
import path from 'path';
import logger from './logger.js';

const MONITOR_INTERVAL = 5000;
const STATE_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'agent-state.json');
const HISTORY_FILE = path.join(process.env.HOME || process.env.USERPROFILE, '.openchat', 'agent-history.json');

/**
 * Agent 状态枚举
 */
export const AgentState = {
  IDLE: 'idle',
  THINKING: 'thinking',
  EXECUTING: 'executing',
  WAITING_INPUT: 'waiting_input',
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused'
};

/**
 * AgentMonitor - Agent 监控与状态管理
 *
 * 功能：
 * 1. 实时监控所有 Agent 状态
 * 2. 状态持久化（支持恢复）
 * 3. 执行历史记录
 * 4. 人机协作回调
 */
export class AgentMonitor {
  constructor() {
    this.agents = new Map();
    this.subscriptions = [];
    this.interval = null;
    this._isRunning = false;
    this.executionHistory = [];
    this.maxHistorySize = 100;

    // 人机协作回调
    this.onHumanInputNeeded = null;
    this.humanInputCallbacks = new Map();

    // 指标统计
    this.metrics = {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      totalToolsUsed: 0,
      averageIterations: 0
    };
  }

  start() {
    if (this._isRunning) return;

    this._isRunning = true;
    this.subscriptions.push(
      messageBus.subscribe(MESSAGE_TYPES.HEARTBEAT, (msg) => this.handleHeartbeat(msg))
    );

    this.interval = setInterval(() => this.tick(), MONITOR_INTERVAL);

    // 加载持久化状态
    this.loadState().catch(() => {});
  }

  stop() {
    if (!this._isRunning) return;

    this._isRunning = false;

    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.subscriptions.forEach(unsub => {
      try { unsub(); } catch (e) {}
    });
    this.subscriptions = [];

    // 保存状态
    this.saveState().catch(() => {});
  }

  handleHeartbeat(msg) {
    const agentInfo = {
      agentId: msg.agentId,
      name: msg.name,
      state: msg.state,
      iterationCount: msg.iterationCount,
      currentTask: msg.currentTask,
      lastActivity: msg.lastActivity,
      lastHeartbeat: msg.timestamp || Date.now()
    };

    this.agents.set(msg.agentId, agentInfo);
  }

  /**
   * 记录 Agent 执行开始
   */
  recordExecutionStart(agentId, task, metadata = {}) {
    const execution = {
      id: crypto.randomUUID(),
      agentId,
      task: task.substring(0, 200),
      startTime: Date.now(),
      status: AgentState.EXECUTING,
      iterations: 0,
      toolsUsed: [],
      metadata,
      checkpoints: []
    };

    const agent = this.agents.get(agentId) || {};
    agent.currentExecution = execution;
    agent.state = AgentState.EXECUTING;
    this.agents.set(agentId, agent);

    this.metrics.totalExecutions++;

    return execution.id;
  }

  /**
   * 记录工具调用
   */
  recordToolCall(agentId, toolName, args, result) {
    const agent = this.agents.get(agentId);
    if (!agent?.currentExecution) return;

    agent.currentExecution.toolsUsed.push({
      tool: toolName,
      args: JSON.stringify(args).substring(0, 100),
      success: result.success !== false,
      timestamp: Date.now()
    });

    agent.currentExecution.iterations++;
    this.metrics.totalToolsUsed++;
  }

  /**
   * 创建检查点（用于恢复）
   */
  createCheckpoint(agentId, context) {
    const agent = this.agents.get(agentId);
    if (!agent?.currentExecution) return null;

    const checkpoint = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      context: {
        messages: context.messages?.slice(-10),  // 最近10条消息
        variables: context.variables,
        step: context.step
      }
    };

    agent.currentExecution.checkpoints.push(checkpoint);
    return checkpoint.id;
  }

  /**
   * 记录执行完成
   */
  recordExecutionComplete(agentId, result) {
    const agent = this.agents.get(agentId);
    if (!agent?.currentExecution) return;

    const execution = agent.currentExecution;
    execution.endTime = Date.now();
    execution.duration = execution.endTime - execution.startTime;
    execution.status = result.success ? AgentState.COMPLETED : AgentState.FAILED;
    execution.result = result;

    // 更新统计
    if (result.success) {
      this.metrics.successCount++;
    } else {
      this.metrics.failureCount++;
    }
    this.metrics.averageIterations =
      (this.metrics.averageIterations * (this.metrics.totalExecutions - 1) + execution.iterations) /
      this.metrics.totalExecutions;

    // 添加到历史
    this.executionHistory.push(execution);
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }

    // 清理当前执行
    agent.currentExecution = null;
    agent.state = AgentState.IDLE;

    // 异步保存
    this.saveState().catch(() => {});
  }

  /**
   * 请求人机协作
   */
  async requestHumanInput(agentId, prompt, options = {}) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    agent.state = AgentState.WAITING_INPUT;
    agent.waitingFor = prompt;

    // 如果有回调，直接调用
    if (this.onHumanInputNeeded) {
      const response = await this.onHumanInputNeeded(agentId, prompt, options);
      return response;
    }

    // 否则等待外部输入
    return new Promise((resolve) => {
      this.humanInputCallbacks.set(agentId, resolve);
    });
  }

  /**
   * 提供人机协作输入
   */
  provideHumanInput(agentId, input) {
    const callback = this.humanInputCallbacks.get(agentId);
    if (callback) {
      callback(input);
      this.humanInputCallbacks.delete(agentId);

      const agent = this.agents.get(agentId);
      if (agent) {
        agent.state = AgentState.EXECUTING;
        agent.waitingFor = null;
      }
    }
  }

  /**
   * 暂停 Agent
   */
  pauseAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.state = AgentState.PAUSED;
      agent.pausedAt = Date.now();

      // 创建恢复点
      if (agent.currentExecution) {
        this.createCheckpoint(agentId, { step: agent.currentExecution.iterations });
      }
    }
  }

  /**
   * 恢复 Agent
   */
  resumeAgent(agentId) {
    const agent = this.agents.get(agentId);
    if (agent && agent.state === AgentState.PAUSED) {
      agent.state = AgentState.EXECUTING;
      agent.pausedAt = null;
    }
  }

  /**
   * 获取可恢复的 Agent
   */
  getResumableAgents() {
    return Array.from(this.agents.values())
      .filter(a => a.state === AgentState.PAUSED || a.currentExecution?.checkpoints?.length > 0);
  }

  tick() {
    // 检查超时的 Agent
    const now = Date.now();
    for (const [id, agent] of this.agents) {
      if (agent.state === AgentState.EXECUTING) {
        const lastActivity = agent.lastActivity || agent.lastHeartbeat || 0;
        if (now - lastActivity > 60000) { // 1分钟无活动
          logger.warn(`[Monitor] Agent ${id} may be stuck (no activity for ${Math.floor((now - lastActivity) / 1000)}s)`);
        }
      }
    }
  }

  /**
   * 获取监控摘要
   */
  getSummary() {
    const agents = this.getAgentList();
    const byState = {};

    for (const agent of agents) {
      byState[agent.state] = (byState[agent.state] || 0) + 1;
    }

    return {
      totalAgents: agents.length,
      byState,
      metrics: this.metrics,
      recentHistory: this.executionHistory.slice(-5).map(e => ({
        id: e.id,
        agentId: e.agentId,
        task: e.task.substring(0, 50),
        status: e.status,
        duration: e.duration
      }))
    };
  }

  getAgentList() {
    return Array.from(this.agents.values());
  }

  getAgent(agentId) {
    return this.agents.get(agentId);
  }

  getExecutionHistory(limit = 20) {
    return this.executionHistory.slice(-limit);
  }

  formatAgentStatus(agent) {
    const timeSinceActivity = Date.now() - (agent.lastActivity || agent.lastHeartbeat);
    const seconds = Math.floor(timeSinceActivity / 1000);
    const activityStr = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`;

    let status = `${agent.name || agent.agentId.substring(0, 8)}`;
    status += ` [${agent.state}]`;

    if (agent.currentTask) {
      status += ` - ${agent.currentTask.substring(0, 25)}`;
    }

    status += ` (${agent.iterationCount} iter, ${activityStr})`;

    return status;
  }

  printStatus() {
    const agents = this.getAgentList();

    if (agents.length === 0) {
      logger.info('[Monitor] No active agents');
      return;
    }

    logger.info('\n╔═══════════════════════════════════════════════════════════╗');
    logger.info('║              Agent Monitoring Status                       ║');
    logger.info('╚═══════════════════════════════════════════════════════════╝');

    for (const agent of agents) {
      logger.info(`  ${this.formatAgentStatus(agent)}`);
    }

    logger.info('');
    logger.info(`  Metrics: ${this.metrics.totalExecutions} executions, ${this.metrics.successCount} success, ${this.metrics.totalToolsUsed} tools used`);
    logger.info('');
  }

  /**
   * 保存状态到文件
   */
  async saveState() {
    try {
      const dir = path.dirname(STATE_FILE);
      await fs.mkdir(dir, { recursive: true });

      const state = {
        agents: Array.from(this.agents.entries()),
        metrics: this.metrics,
        savedAt: Date.now()
      };

      await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));

      // 保存历史（最近的）
      await fs.writeFile(HISTORY_FILE, JSON.stringify(this.executionHistory.slice(-50), null, 2));
    } catch (e) {
      logger.warn('[Monitor] Failed to save state:', e.message);
    }
  }

  /**
   * 加载状态
   */
  async loadState() {
    try {
      const data = await fs.readFile(STATE_FILE, 'utf8');
      const state = JSON.parse(data);

      if (state.agents) {
        for (const [id, agent] of state.agents) {
          // 恢复暂停的 Agent
          if (agent.state === AgentState.PAUSED || agent.state === AgentState.EXECUTING) {
            agent.state = AgentState.PAUSED;
            agent.recovered = true;
          }
          this.agents.set(id, agent);
        }
      }

      if (state.metrics) {
        this.metrics = { ...this.metrics, ...state.metrics };
      }

      // 加载历史
      try {
        const historyData = await fs.readFile(HISTORY_FILE, 'utf8');
        this.executionHistory = JSON.parse(historyData);
      } catch {
        // 历史文件不存在
      }

      const recoveredCount = Array.from(this.agents.values()).filter(a => a.recovered).length;
      if (recoveredCount > 0) {
        logger.info(`[Monitor] Recovered ${recoveredCount} paused agent(s)`);
      }
    } catch (e) {
      // 状态文件不存在，忽略
    }
  }
}

export const agentMonitor = new AgentMonitor();
export default agentMonitor;
