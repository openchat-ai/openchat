/**
 * Agent通信协议
 * 实现Agent间的通信和协作
 */

export const MESSAGE_TYPES = {
  TASK_REQUEST: 'task_request',
  TASK_RESPONSE: 'task_response',
  TASK_PROGRESS: 'task_progress',
  COORDINATION_REQUEST: 'coordination_request',
  COORDINATION_RESPONSE: 'coordination_response',
  HEARTBEAT: 'heartbeat',
  STATUS_UPDATE: 'status_update',
  ERROR: 'error',
  RESULT_SHARE: 'result_share',
  RESOURCE_REQUEST: 'resource_request',
  RESOURCE_RESPONSE: 'resource_response'
};

export class AgentCommunicationProtocol {
  constructor(options = {}) {
    this.agents = new Map();
    this.messageQueue = [];
    this.handlers = new Map();
    this.middleware = [];
    
    this.timeout = options.timeout || 30000; // 30秒默认超时
    this.retryAttempts = options.retryAttempts || 3;
    this.heartbeatInterval = options.heartbeatInterval || 30000; // 30秒心跳间隔
    
    // 消息ID生成器
    this.messageIdCounter = 0;
  }

  /**
   * 注册Agent
   */
  registerAgent(agentId, agentInfo) {
    const agent = {
      id: agentId,
      info: agentInfo,
      connected: true,
      lastSeen: Date.now(),
      capabilities: agentInfo.capabilities || [],
      status: 'online',
      messageHandlers: new Map()
    };
    
    this.agents.set(agentId, agent);
    
    // 设置心跳监测
    this._startHeartbeatMonitoring(agentId);
    
    console.log(`[ACProtocol] Registered agent: ${agentId}`, agent.capabilities);
    
    return agentId;
  }

  /**
   * 发送消息
   */
  async sendMessage(toAgentId, messageType, payload, options = {}) {
    const fromAgentId = options.from || 'system';
    const messageId = options.messageId || this._generateMessageId();
    const correlationId = options.correlationId || this._generateCorrelationId();
    
    const message = {
      id: messageId,
      correlationId,
      type: messageType,
      from: fromAgentId,
      to: toAgentId,
      payload,
      timestamp: Date.now(),
      ttl: options.ttl || 60000, // 60秒生存时间
      priority: options.priority || 0 // 0为普通优先级
    };
    
    // 应用中间件
    for (const middleware of this.middleware) {
      await middleware(message);
    }
    
    // 检查目标Agent是否存在
    const targetAgent = this.agents.get(toAgentId);
    if (!targetAgent) {
      throw new Error(`Target agent not found: ${toAgentId}`);
    }
    
    // 检查目标Agent是否在线
    if (targetAgent.status !== 'online') {
      throw new Error(`Target agent offline: ${toAgentId}`);
    }
    
    // 发送消息（在实际实现中，这里会通过某种传输机制发送）
    const result = await this._deliverMessage(message);
    
    return result;
  }

  /**
   * 广播消息
   */
  async broadcastMessage(messageType, payload, filterFn = null) {
    const results = {};
    
    for (const [agentId, agent] of this.agents) {
      // 应用过滤器
      if (filterFn && !filterFn(agent)) {
        continue;
      }
      
      try {
        const result = await this.sendMessage(agentId, messageType, payload);
        results[agentId] = result;
      } catch (error) {
        results[agentId] = { error: error.message };
      }
    }
    
    return results;
  }

  /**
   * 传递消息（模拟实现）
   */
  async _deliverMessage(message) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Message delivery timeout for ${message.id}`));
      }, message.ttl);

      // 模拟消息传递延迟
      setTimeout(() => {
        clearTimeout(timeoutId);
        
        // 将消息分发给相应的处理程序
        const targetAgent = this.agents.get(message.to);
        if (!targetAgent) {
          reject(new Error(`Target agent disconnected: ${message.to}`));
          return;
        }
        
        // 查找并调用相应的消息处理器
        const handler = targetAgent.messageHandlers.get(message.type);
        if (handler) {
          try {
            const result = handler(message);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        } else {
          // 如果没有特定处理器，使用默认处理器
          const result = this._handleDefaultMessage(message);
          resolve(result);
        }
      }, Math.random() * 100); // 模拟网络延迟
    });
  }

  /**
   * 注册消息处理器
   */
  registerMessageHandler(agentId, messageType, handler) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    
    agent.messageHandlers.set(messageType, handler);
    
    console.log(`[ACProtocol] Registered handler for ${agentId}: ${messageType}`);
  }

  /**
   * 默认消息处理器
   */
  _handleDefaultMessage(message) {
    console.log(`[ACProtocol] Unhandled message: ${message.type} from ${message.from} to ${message.to}`);
    
    // 对于某些消息类型，提供默认响应
    switch (message.type) {
      case MESSAGE_TYPES.HEARTBEAT:
        return { status: 'ok', timestamp: Date.now() };
      case MESSAGE_TYPES.STATUS_UPDATE:
        return { received: true, timestamp: Date.now() };
      default:
        return { received: true, messageId: message.id };
    }
  }

  /**
   * 协调任务执行
   */
  async coordinateTask(taskSpec, participatingAgents) {
    const coordinationId = this._generateCorrelationId();
    
    // 发送协调请求给参与的Agents
    const coordinationRequests = participatingAgents.map(agentId => 
      this.sendMessage(agentId, MESSAGE_TYPES.COORDINATION_REQUEST, {
        coordinationId,
        taskSpec,
        participants: participatingAgents
      })
    );
    
    // 等待协调响应
    const responses = await Promise.allSettled(coordinationRequests);
    
    const successfulResponses = responses
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
    
    if (successfulResponses.length === 0) {
      throw new Error('No agents responded to coordination request');
    }
    
    // 根据响应协调任务分配
    const coordinationResult = {
      coordinationId,
      participants: participatingAgents,
      responses: successfulResponses,
      tasksAssigned: this._assignTasksBasedOnResponses(taskSpec, successfulResponses)
    };
    
    return coordinationResult;
  }

  /**
   * 基于响应分配任务
   */
  _assignTasksBasedOnResponses(taskSpec, responses) {
    // 这里实现任务分配逻辑
    // 基于Agents的能力、负载等因素分配任务
    
    const assignments = [];
    
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      const agentId = response.participantId || `agent_${i}`;
      
      assignments.push({
        agentId,
        subtask: taskSpec.subtasks ? taskSpec.subtasks[i % (taskSpec.subtasks.length || 1)] : taskSpec,
        assignmentId: this._generateCorrelationId()
      });
    }
    
    return assignments;
  }

  /**
   * 开始心跳监测
   */
  _startHeartbeatMonitoring(agentId) {
    const heartbeatInterval = setInterval(() => {
      this._sendHeartbeat(agentId)
        .catch(err => {
          console.error(`[ACProtocol] Heartbeat failed for agent ${agentId}:`, err);
          // 标记Agent为离线
          const agent = this.agents.get(agentId);
          if (agent) {
            agent.status = 'offline';
            agent.connected = false;
          }
        });
    }, this.heartbeatInterval);
    
    // 存储心跳定时器以便后续清理
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.heartbeatTimer = heartbeatInterval;
    }
  }

  /**
   * 发送心跳
   */
  async _sendHeartbeat(agentId) {
    const response = await this.sendMessage(
      agentId, 
      MESSAGE_TYPES.HEARTBEAT, 
      { timestamp: Date.now() },
      { ttl: 5000 } // 5秒超时
    );
    
    // 更新Agent状态
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'online';
      agent.lastSeen = Date.now();
      agent.connected = true;
    }
    
    return response;
  }

  /**
   * 添加中间件
   */
  use(middleware) {
    this.middleware.push(middleware);
  }

  /**
   * 生成消息ID
   */
  _generateMessageId() {
    return `msg_${++this.messageIdCounter}_${Date.now()}`;
  }

  /**
   * 生成关联ID
   */
  _generateCorrelationId() {
    return `corr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取Agent列表
   */
  getOnlineAgents() {
    return Array.from(this.agents.values())
      .filter(agent => agent.status === 'online');
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const onlineAgents = this.getOnlineAgents();
    
    return {
      totalAgents: this.agents.size,
      onlineAgents: onlineAgents.length,
      offlineAgents: this.agents.size - onlineAgents.length,
      registeredHandlers: Array.from(this.agents.values())
        .reduce((total, agent) => total + agent.messageHandlers.size, 0)
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 清理所有心跳定时器
    for (const [, agent] of this.agents) {
      if (agent.heartbeatTimer) {
        clearInterval(agent.heartbeatTimer);
      }
    }
    
    this.agents.clear();
    this.messageQueue = [];
    this.handlers.clear();
    this.middleware = [];
  }
}

// 默认导出
export default AgentCommunicationProtocol;