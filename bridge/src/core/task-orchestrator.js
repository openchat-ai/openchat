import logger from './logger.js';
/**
 * 任务编排器
 * 负责任务分解、分配和同步
 */

export class TaskOrchestrator {
  constructor(options = {}) {
    this.tasks = new Map();
    this.agents = new Map();
    this.dependencies = new Map(); // 任务依赖关系
    this.subscribers = new Map(); // 任务状态订阅者
    
    this.maxConcurrency = options.maxConcurrency || 5;
    this.timeout = options.timeout || 30000; // 30秒超时
    this.retryAttempts = options.retryAttempts || 3;
    
    // 任务队列
    this.readyQueue = []; // 就绪任务
    this.waitingQueue = []; // 等待依赖的任务
    this.runningTasks = new Set(); // 运行中的任务
  }

  /**
   * 注册代理
   */
  registerAgent(agentId, agentSpec) {
    this.agents.set(agentId, {
      id: agentId,
      capabilities: agentSpec.capabilities || [],
      status: 'available',
      busyCount: 0,
      lastActivity: Date.now(),
      maxConcurrency: agentSpec.maxConcurrency || 1
    });
    
    logger.info(`[TaskOrchestrator] Registered agent: ${agentId}`, agentSpec.capabilities);
  }

  /**
   * 提交任务
   */
  submitTask(taskSpec) {
    const taskId = taskSpec.id || this._generateId();
    
    const task = {
      id: taskId,
      name: taskSpec.name,
      description: taskSpec.description,
      dependencies: taskSpec.dependencies || [],
      capabilities: taskSpec.capabilities || [],
      priority: taskSpec.priority || 0,
      timeout: taskSpec.timeout || this.timeout,
      data: taskSpec.data || {},
      status: 'pending',
      assignedAgent: null,
      result: null,
      error: null,
      retries: 0,
      maxRetries: taskSpec.maxRetries || this.retryAttempts,
      submittedAt: Date.now(),
      startedAt: null,
      completedAt: null
    };
    
    this.tasks.set(taskId, task);
    
    // 检查依赖关系
    if (task.dependencies.length === 0) {
      // 没有依赖，直接放入就绪队列
      this.readyQueue.push(taskId);
    } else {
      // 有待处理依赖，放入等待队列
      this.waitingQueue.push(taskId);
      this._setupDependencies(taskId, task.dependencies);
    }
    
    logger.info(`[TaskOrchestrator] Submitted task: ${taskId} - ${task.name}`);
    
    // 尝试处理任务
    this._processQueues();
    
    return taskId;
  }

  /**
   * 设置任务依赖关系
   */
  _setupDependencies(taskId, dependencies) {
    for (const depId of dependencies) {
      if (!this.dependencies.has(depId)) {
        this.dependencies.set(depId, new Set());
      }
      this.dependencies.get(depId).add(taskId);
    }
  }

  /**
   * 检查任务依赖是否满足
   */
  _checkDependencies(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    
    for (const depId of task.dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask || depTask.status !== 'completed') {
        return false; // 依赖任务未完成
      }
    }
    
    return true; // 所有依赖都已完成
  }

  /**
   * 选择最适合的代理
   */
  _selectBestAgent(task) {
    const availableAgents = Array.from(this.agents.values())
      .filter(agent => 
        agent.status === 'available' && 
        agent.busyCount < agent.maxConcurrency &&
        this._hasRequiredCapabilities(agent, task)
      )
      .sort((a, b) => {
        // 优先选择空闲时间较长的代理
        return (b.lastActivity - a.lastActivity) + 
               (b.busyCount - a.busyCount); // 负载较轻的优先
      });
    
    return availableAgents[0] || null;
  }

  /**
   * 检查代理是否具备所需能力
   */
  _hasRequiredCapabilities(agent, task) {
    if (!task.capabilities || task.capabilities.length === 0) {
      return true; // 无特殊能力要求
    }
    
    return task.capabilities.every(cap => 
      agent.capabilities.includes(cap)
    );
  }

  /**
   * 执行任务
   */
  async _executeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 选择代理
    const agent = this._selectBestAgent(task);
    if (!agent) {
      throw new Error(`No suitable agent available for task: ${taskId}`);
    }

    try {
      // 更新任务状态
      task.status = 'running';
      task.assignedAgent = agent.id;
      task.startedAt = Date.now();
      this.runningTasks.add(taskId);
      
      // 更新代理状态
      agent.status = 'busy';
      agent.busyCount++;
      agent.lastActivity = Date.now();

      logger.info(`[TaskOrchestrator] Assigning task ${taskId} to agent ${agent.id}`);

      // 执行任务（超时控制）
      const result = await this._executeTaskWithTimeout(task, agent);
      
      // 任务成功完成
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      
      logger.info(`[TaskOrchestrator] Task ${taskId} completed successfully`);
      
      // 通知依赖任务
      this._notifyDependents(taskId);
      
      return result;
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.completedAt = Date.now();
      
      logger.error(`[TaskOrchestrator] Task ${taskId} failed:`, error);
      
      // 检查是否需要重试
      if (task.retries < task.maxRetries) {
        task.retries++;
        task.status = 'pending';
        this.readyQueue.unshift(taskId); // 重新放入队列头部
        logger.info(`[TaskOrchestrator] Retrying task ${taskId} (${task.retries}/${task.maxRetries})`);
      }
      
      throw error;
    } finally {
      // 更新代理状态
      agent.busyCount--;
      if (agent.busyCount <= 0) {
        agent.status = 'available';
        agent.busyCount = 0;
      }
      
      // 从运行任务中移除
      this.runningTasks.delete(taskId);
      
      // 处理队列
      this._processQueues();
    }
  }

  /**
   * 带超时的任务执行
   */
  _executeTaskWithTimeout(task, agent) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`));
      }, task.timeout);

      // 执行任务（这里应该是调用代理的实际方法）
      Promise.resolve()
        .then(async () => {
          // 模拟任务执行 - 在实际实现中，这里会调用代理的处理函数
          const result = await this._simulateTaskExecution(task, agent);
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * 模拟任务执行（实际实现中会替换为真实的代理调用）
   */
  async _simulateTaskExecution(task, agent) {
    // 在实际实现中，这里会通过某种通信机制调用代理
    // 目前使用模拟实现
    logger.info(`[Simulator] Executing task ${task.id} on agent ${agent.id}`);
    
    // 模拟执行时间
    const executionTime = Math.min(1000 + Math.random() * 2000, task.timeout / 2);
    await new Promise(resolve => setTimeout(resolve, executionTime));
    
    // 模拟任务结果
    return {
      taskId: task.id,
      agentId: agent.id,
      result: `Task ${task.name} completed by agent ${agent.id}`,
      executionTime,
      data: task.data
    };
  }

  /**
   * 通知依赖任务
   */
  _notifyDependents(taskId) {
    const dependents = this.dependencies.get(taskId);
    if (!dependents) return;

    for (const dependentId of dependents) {
      const waitingIndex = this.waitingQueue.indexOf(dependentId);
      if (waitingIndex !== -1) {
        // 检查依赖是否都已完成
        if (this._checkDependencies(dependentId)) {
          // 依赖都已完成，移动到就绪队列
          this.waitingQueue.splice(waitingIndex, 1);
          this.readyQueue.push(dependentId);
          logger.info(`[TaskOrchestrator] Dependencies satisfied for task ${dependentId}`);
        }
      }
    }
    
    // 处理队列
    this._processQueues();
  }

  /**
   * 处理队列中的任务
   */
  _processQueues() {
    // 检查等待队列中是否有可以移动到就绪队列的任务
    for (let i = this.waitingQueue.length - 1; i >= 0; i--) {
      const taskId = this.waitingQueue[i];
      if (this._checkDependencies(taskId)) {
        this.waitingQueue.splice(i, 1);
        this.readyQueue.push(taskId);
      }
    }
    
    // 执行就绪队列中的任务（在并发限制内）
    while (this.runningTasks.size < this.maxConcurrency && this.readyQueue.length > 0) {
      const taskId = this.readyQueue.shift();
      
      // 异步执行任务
      this._executeTask(taskId).catch(error => {
        logger.error('Error executing task:', error);
      });
    }
  }

  /**
   * 等待任务完成
   */
  async waitForTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 如果任务已完成，直接返回结果
    if (task.status === 'completed') {
      return task.result;
    }

    // 如果任务失败，抛出错误
    if (task.status === 'failed') {
      throw new Error(task.error || `Task ${taskId} failed`);
    }

    // 等待任务完成（最多等待任务超时时间）
    const timeout = task.timeout;
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (task.status === 'completed') {
        return task.result;
      }
      if (task.status === 'failed') {
        throw new Error(task.error || `Task ${taskId} failed`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Wait timeout for task ${taskId}`);
  }

  /**
   * 订阅任务状态
   */
  subscribeToTask(taskId, callback) {
    if (!this.subscribers.has(taskId)) {
      this.subscribers.set(taskId, []);
    }
    this.subscribers.get(taskId).push(callback);
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }
    
    return {
      id: task.id,
      name: task.name,
      status: task.status,
      assignedAgent: task.assignedAgent,
      result: task.result,
      error: task.error,
      retries: task.retries,
      submittedAt: task.submittedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt
    };
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats = {
      totalTasks: this.tasks.size,
      pendingTasks: this.tasks.size - Array.from(this.tasks.values()).filter(t => t.status !== 'pending').length,
      runningTasks: this.runningTasks.size,
      completedTasks: Array.from(this.tasks.values()).filter(t => t.status === 'completed').length,
      failedTasks: Array.from(this.tasks.values()).filter(t => t.status === 'failed').length,
      readyQueue: this.readyQueue.length,
      waitingQueue: this.waitingQueue.length,
      totalAgents: this.agents.size,
      availableAgents: Array.from(this.agents.values()).filter(a => a.status === 'available').length
    };
    
    return stats;
  }

  /**
   * 生成ID
   */
  _generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 执行任务分解
   */
  async decomposeComplexTask(complexTaskSpec) {
    // 这里实现任务分解逻辑
    // 将复杂任务分解为子任务
    const subtasks = complexTaskSpec.subtasks || [];
    
    // 提交所有子任务
    const taskIds = [];
    for (const subtask of subtasks) {
      const taskId = this.submitTask({
        ...subtask,
        dependencies: subtask.dependencies || []
      });
      taskIds.push(taskId);
    }
    
    return taskIds;
  }
}

// 默认导出
export default TaskOrchestrator;