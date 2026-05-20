/**
 * Base Agent Class
 * 所有 Agent 的基类
 */

class BaseAgent {
  constructor(options = {}) {
    this.id = options.id || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.name = options.name || 'Unnamed Agent';
    this.role = options.role || 'custom';
    this.capabilities = options.capabilities || [];
    this.task = options.task || null;
    this.status = 'INITIALIZING';

    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.completedAt = null;

    this.feedback = [];
    this.metadata = {};
  }

  /**
   * 初始化 Agent
   */
  async initialize() {
    this.status = 'READY';
    console.log(`[Agent] ${this.name} (${this.role}) initialized`);
    return this;
  }

  /**
   * 执行任务
   */
  async execute(task) {
    this.task = task;
    this.status = 'RUNNING';
    this.startedAt = new Date().toISOString();

    try {
      const result = await this.runTask(task);
      this.status = 'COMPLETED';
      this.completedAt = new Date().toISOString();
      return result;
    } catch (error) {
      this.status = 'FAILED';
      this.completedAt = new Date().toISOString();
      throw error;
    }
  }

  /**
   * 运行任务的抽象方法 - 子类实现
   */
  async runTask(task) {
    throw new Error('runTask() must be implemented by subclass');
  }

  /**
   * 添加反馈
   */
  addFeedback(feedback) {
    this.feedback.push({
      ...feedback,
      agentId: this.id,
      agentRole: this.role,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 获取反馈
   */
  getFeedback() {
    return this.feedback;
  }

  /**
   * 终止 Agent
   */
  async terminate() {
    this.status = 'TERMINATED';
    this.completedAt = new Date().toISOString();
    console.log(`[Agent] ${this.name} terminated`);
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      id: this.id,
      name: this.name,
      role: this.role,
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt
    };
  }
}

module.exports = BaseAgent;