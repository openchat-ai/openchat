/**
 * Custom Agent
 * 自定义角色
 */

const BaseAgent = require('./base-agent');

class CustomAgent extends BaseAgent {
  constructor(options = {}) {
    super({
      ...options,
      role: 'custom',
      name: options.name || 'Custom Agent',
      capabilities: options.capabilities || []
    });

    this.customLogic = options.customLogic || null;
  }

  /**
   * 运行自定义任务
   */
  async runTask(task) {
    console.log(`[CustomAgent] Running custom task: ${task.description || 'unnamed'}`);

    const results = {
      custom: true,
      task: task.description || task,
      executedAt: new Date().toISOString(),
      output: null,
      metadata: {}
    };

    // 执行自定义逻辑
    if (this.customLogic && typeof this.customLogic === 'function') {
      try {
        results.output = await this.customLogic(task);
      } catch (error) {
        results.error = error.message;
        results.status = 'FAILED';
      }
    } else {
      // 默认：简单处理
      results.output = `Processed task: ${JSON.stringify(task).slice(0, 100)}`;
    }

    results.status = results.error ? 'FAILED' : 'SUCCESS';

    // 生成反馈
    this.addFeedback({
      type: 'custom_task',
      task: results.task,
      status: results.status,
      output: results.output,
      summary: `Custom agent completed task: ${results.status}`
    });

    return results;
  }

  /**
   * 设置自定义逻辑
   */
  setCustomLogic(logic) {
    if (typeof logic === 'function') {
      this.customLogic = logic;
      this.capabilities.push('custom_logic');
    }
  }
}

module.exports = CustomAgent;