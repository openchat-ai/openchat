/**
 * 协作引擎
 * 整合任务编排、Agent通信和结果聚合
 */

import TaskOrchestrator from './task-orchestrator.js';
import AgentCommunicationProtocol, { MESSAGE_TYPES } from '../agent/agent-communication-protocol.js';
import ResultAggregator from '../convergence/result-aggregator.js';
import logger from '../logger.js';

export class CollaborationEngine {
  constructor(options = {}) {
    this.options = {
      maxConcurrency: options.maxConcurrency || 5,
      heartbeatInterval: options.heartbeatInterval || 30000,
      timeout: options.timeout || 30000,
      retryAttempts: options.retryAttempts || 3,
      aggregationStrategy: options.aggregationStrategy || 'consensus',
      consensusThreshold: options.consensusThreshold || 0.6,
      ...options
    };
    
    // 初始化组件
    this.taskOrchestrator = new TaskOrchestrator({
      maxConcurrency: this.options.maxConcurrency,
      timeout: this.options.timeout,
      retryAttempts: this.options.retryAttempts
    });
    
    this.communicationProtocol = new AgentCommunicationProtocol({
      timeout: this.options.timeout,
      heartbeatInterval: this.options.heartbeatInterval,
      retryAttempts: this.options.retryAttempts
    });
    
    this.resultAggregator = new ResultAggregator({
      aggregationStrategy: this.options.aggregationStrategy,
      consensusThreshold: this.options.consensusThreshold
    });

    // 任务到Agent的映射
    this.taskToAgents = new Map();
  }

  /**
   * 注册Agent
   */
  registerAgent(agentId, agentSpec) {
    // 注册到所有组件
    this.taskOrchestrator.registerAgent(agentId, agentSpec);
    this.communicationProtocol.registerAgent(agentId, agentSpec);
    this.resultAggregator.registerAgent(agentId, agentSpec);
  }

  /**
   * 协作执行任务
   */
  async collaborateOnTask(taskSpec) {
    const taskId = taskSpec.id || this._generateId();
    
    // 1. 根据任务需求选择合适的Agents
    const participatingAgents = this._selectAgentsForTask(taskSpec);
    
    if (participatingAgents.length === 0) {
      throw new Error('No suitable agents available for task');
    }
    
    logger.info(`[CollaborationEngine] Selected ${participatingAgents.length} agents for task ${taskId}`);
    
    // 2. 如果是复合任务，分解为子任务
    if (taskSpec.subtasks && taskSpec.subtasks.length > 0) {
      return await this._executeDecomposedTask(taskId, taskSpec, participatingAgents);
    } else {
      // 3. 直接协调Agents执行任务
      return await this._coordinateDirectExecution(taskId, taskSpec, participatingAgents);
    }
  }

  /**
   * 选择适合任务的Agents
   */
  _selectAgentsForTask(taskSpec) {
    const requiredCapabilities = taskSpec.requirements?.capabilities || [];
    
    return Array.from(this.communicationProtocol.agents.values())
      .filter(agent => {
        if (agent.status !== 'online') return false;
        
        // 检查能力要求
        if (requiredCapabilities.length > 0) {
          return requiredCapabilities.every(reqCap => 
            agent.capabilities.includes(reqCap)
          );
        }
        
        return true; // 无特殊要求
      })
      .map(agent => agent.id)
      .slice(0, this.options.maxConcurrency); // 限制并发数
  }

  /**
   * 执行分解后的任务
   */
  async _executeDecomposedTask(taskId, taskSpec, participatingAgents) {
    // 为每个子任务分配Agent
    const subtaskAssignments = this._assignSubtasksToAgents(
      taskSpec.subtasks,
      participatingAgents
    );
    
    // 提交子任务
    const subtaskPromises = subtaskAssignments.map(async (assignment, index) => {
      const subtaskId = `${taskId}_subtask_${index}`;
      
      const subtaskSpec = {
        id: subtaskId,
        name: assignment.subtask.name || `Subtask ${index}`,
        description: assignment.subtask.description,
        data: assignment.subtask.data,
        dependencies: assignment.subtask.dependencies || [],
        capabilities: assignment.subtask.capabilities || [],
        assignedAgent: assignment.agentId
      };
      
      // 发送任务到指定的Agent
      try {
        const response = await this.communicationProtocol.sendMessage(
          assignment.agentId,
          MESSAGE_TYPES.TASK_REQUEST,
          {
            taskId: subtaskId,
            taskSpec: subtaskSpec,
            parentTaskId: taskId
          }
        );
        
        // 提交结果
        this.resultAggregator.submitResult(subtaskId, assignment.agentId, response);
        
        return {
          subtaskId,
          agentId: assignment.agentId,
          result: response,
          success: true
        };
      } catch (error) {
        return {
          subtaskId,
          agentId: assignment.agentId,
          error: error.message,
          success: false
        };
      }
    });
    
    // 等待所有子任务完成
    const subtaskResults = await Promise.all(subtaskPromises);
    
    // 聚合子任务结果
    const aggregatedResult = this.resultAggregator.aggregateResults(taskId);
    
    return {
      taskId,
      success: subtaskResults.every(r => r.success),
      subtaskResults,
      aggregatedResult,
      participatingAgents
    };
  }

  /**
   * 协调直接执行
   */
  async _coordinateDirectExecution(taskId, taskSpec, participatingAgents) {
    // 使用通信协议协调多个Agents
    const coordinationResult = await this.communicationProtocol.coordinateTask(
      taskSpec,
      participatingAgents
    );
    
    // 根据协调结果执行任务
    const executionResults = [];
    
    for (const assignment of coordinationResult.tasksAssigned) {
      try {
        const response = await this.communicationProtocol.sendMessage(
          assignment.agentId,
          MESSAGE_TYPES.TASK_REQUEST,
          {
            taskId: assignment.assignmentId,
            taskSpec,
            coordinationId: coordinationResult.coordinationId
          }
        );
        
        // 提交结果到聚合器
        this.resultAggregator.submitResult(
          assignment.assignmentId,
          assignment.agentId,
          { ...response, assignmentId: assignment.assignmentId }
        );
        
        executionResults.push({
          assignmentId: assignment.assignmentId,
          agentId: assignment.agentId,
          result: response,
          success: true
        });
      } catch (error) {
        executionResults.push({
          assignmentId: assignment.assignmentId,
          agentId: assignment.agentId,
          error: error.message,
          success: false
        });
      }
    }
    
    // 聚合最终结果
    const aggregatedResult = this.resultAggregator.aggregateResults(taskId);
    
    return {
      taskId,
      success: executionResults.every(r => r.success),
      coordinationResult,
      executionResults,
      aggregatedResult,
      participatingAgents
    };
  }

  /**
   * 分配子任务到Agents
   */
  _assignSubtasksToAgents(subtasks, agentIds) {
    if (agentIds.length === 0) {
      return [];
    }
    
    return subtasks.map((subtask, index) => {
      const agentId = agentIds[index % agentIds.length]; // 轮询分配
      
      return {
        subtask,
        agentId,
        assignmentOrder: index
      };
    });
  }

  /**
   * 并行执行多个任务
   */
  async executeMultipleTasks(taskSpecs) {
    const taskPromises = taskSpecs.map(taskSpec => 
      this.collaborateOnTask(taskSpec)
    );
    
    return await Promise.all(taskPromises);
  }

  /**
   * 广播消息给所有在线Agents
   */
  async broadcastToAgents(messageType, payload) {
    return await this.communicationProtocol.broadcastMessage(
      messageType,
      payload,
      agent => agent.status === 'online'
    );
  }

  /**
   * 获取协作统计
   */
  getStats() {
    return {
      taskOrchestrator: this.taskOrchestrator.getStats(),
      communicationProtocol: this.communicationProtocol.getStats(),
      resultAggregator: this.resultAggregator.getStats(),
      totalRegisteredAgents: this.communicationProtocol.agents.size,
      onlineAgents: this.communicationProtocol.getOnlineAgents().length,
      options: this.options
    };
  }

  /**
   * 获取特定任务状态
   */
  getTaskStatus(taskId) {
    return this.taskOrchestrator.getTaskStatus(taskId);
  }

  /**
   * 获取Agent状态
   */
  getAgentStatus(agentId) {
    const commAgent = this.communicationProtocol.agents.get(agentId);
    const agentStats = this.resultAggregator.getAgentStats(agentId);
    
    return {
      id: agentId,
      communicationStatus: commAgent ? commAgent.status : 'unknown',
      connectionStatus: commAgent ? commAgent.connected : false,
      lastSeen: commAgent ? commAgent.lastSeen : null,
      capabilities: commAgent ? commAgent.capabilities : [],
      performanceStats: agentStats
    };
  }

  /**
   * 生成ID
   */
  _generateId() {
    return `collab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 清理资源
   */
  cleanup() {
    this.taskOrchestrator.cleanup();
    this.communicationProtocol.cleanup();
    // 注意：ResultAggregator不需要特殊清理
  }
}

// 默认导出
export default CollaborationEngine;