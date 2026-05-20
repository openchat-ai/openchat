/**
 * 协作管理器 - 次 AI 间协作机制
 *
 * 功能：
 * - 协作请求
 * - 协作响应
 * - 结果记录
 */

import { persistentConfig } from './persistent-config.js';
import logger from './logger.js';

export class CollaborationManager {
  constructor() {
    this.activeCollaborations = new Map();  // 进行中的协作
    this.collaborationHistory = [];          // 历史记录
    this.maxActiveCollaborations = 20;       // 最大并行协作数
  }

  /**
   * 发起协作请求
   */
  async requestCollaboration(fromAgent, toAgent, message, context = {}) {
    // 检查是否已达上限
    if (this.activeCollaborations.size >= this.maxActiveCollaborations) {
      throw new Error('Maximum active collaborations reached');
    }

    const collaboration = {
      collaboration_id: crypto.randomUUID(),
      from_agent: {
        agent_id: fromAgent.agent_id,
        type: fromAgent.type
      },
      to_agent: {
        agent_id: toAgent.agent_id,
        type: toAgent.type
      },
      message,
      context,
      status: 'PENDING',
      created_at: new Date().toISOString(),
      responses: []
    };

    this.activeCollaborations.set(collaboration.collaboration_id, collaboration);

    return collaboration;
  }

  /**
   * 接受协作请求
   */
  async acceptCollaboration(collaborationId, respondingAgent, findings) {
    const collaboration = this.activeCollaborations.get(collaborationId);
    if (!collaboration) {
      throw new Error('Collaboration not found');
    }

    if (collaboration.status !== 'PENDING') {
      throw new Error('Collaboration is not pending');
    }

    const response = {
      agent_id: respondingAgent.agent_id,
      agent_type: respondingAgent.type,
      findings,
      responded_at: new Date().toISOString()
    };

    collaboration.responses.push(response);

    // 如果发起方也回复了，则完成协作
    if (collaboration.responses.length >= 2) {
      collaboration.status = 'COMPLETED';
      collaboration.completed_at = new Date().toISOString();
      this.collaborationHistory.push(collaboration);
      this.activeCollaborations.delete(collaborationId);
    } else {
      collaboration.status = 'IN_PROGRESS';
    }

    return collaboration;
  }

  /**
   * 拒绝协作请求
   */
  async rejectCollaboration(collaborationId, respondingAgent, reason) {
    const collaboration = this.activeCollaborations.get(collaborationId);
    if (!collaboration) {
      throw new Error('Collaboration not found');
    }

    collaboration.status = 'REJECTED';
    collaboration.rejection = {
      agent_id: respondingAgent.agent_id,
      reason,
      rejected_at: new Date().toISOString()
    };

    this.collaborationHistory.push(collaboration);
    this.activeCollaborations.delete(collaborationId);

    return collaboration;
  }

  /**
   * 获取协作状态
   */
  getCollaboration(collaborationId) {
    return this.activeCollaborations.get(collaborationId) ||
           this.collaborationHistory.find(c => c.collaboration_id === collaborationId);
  }

  /**
   * 获取 Agent 的协作历史
   */
  getAgentCollaborations(agentId) {
    return this.collaborationHistory.filter(c =>
      c.from_agent.agent_id === agentId ||
      c.to_agent.agent_id === agentId
    );
  }

  /**
   * 获取所有活跃协作
   */
  getActiveCollaborations() {
    return Array.from(this.activeCollaborations.values());
  }

  /**
   * 终止协作
   */
  async terminateCollaboration(collaborationId, reason) {
    const collaboration = this.activeCollaborations.get(collaborationId);
    if (!collaboration) {
      return false;
    }

    collaboration.status = 'TERMINATED';
    collaboration.termination_reason = reason;
    collaboration.terminated_at = new Date().toISOString();

    this.collaborationHistory.push(collaboration);
    this.activeCollaborations.delete(collaborationId);

    return true;
  }

  /**
   * 获取协作统计
   */
  getCollaborationStats(agentId = null) {
    const history = agentId
      ? this.collaborationHistory.filter(c =>
          c.from_agent.agent_id === agentId ||
          c.to_agent.agent_id === agentId
        )
      : this.collaborationHistory;

    const stats = {
      total: history.length,
      completed: history.filter(c => c.status === 'COMPLETED').length,
      rejected: history.filter(c => c.status === 'REJECTED').length,
      terminated: history.filter(c => c.status === 'TERMINATED').length,
      successRate: 0
    };

    if (stats.total > 0) {
      stats.successRate = Math.round((stats.completed / stats.total) * 100);
    }

    return stats;
  }

  /**
   * 持久化历史记录
   */
  async persistHistory() {
    try {
      // 只保留最近 200 条
      const toSave = this.collaborationHistory.slice(-200);
      await persistentConfig.set('collaborations', toSave);
    } catch (e) {
      logger.error('Failed to persist collaboration history:', e);
    }
  }

  /**
   * 加载历史记录
   */
  async loadHistory() {
    try {
      const history = await persistentConfig.get('collaborations');
      if (history && Array.isArray(history)) {
        this.collaborationHistory = history;
      }
    } catch (e) {
      logger.error('Failed to load collaboration history:', e);
    }
  }
}

// 单例
export const collaborationManager = new CollaborationManager();