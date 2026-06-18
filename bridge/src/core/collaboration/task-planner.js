/**
 * TaskPlanner - 智能任务规划器
 *
 * 实现 Plan → Execute → Reflect 循环：
 * 1. 分析用户请求，生成结构化执行计划
 * 2. 按计划执行，收集结果
 * 3. 反思执行结果，必要时调整计划
 */

import { pluginManager } from '../plugin-manager.js';
import { memoryManager } from '../../memory/memory-manager.js';
import { sessionManager } from '../session-manager.js';
import { PromptBuilder } from '../convergence/prompt-builder.js';
import logger from '../monitoring/logger.js';

export class TaskPlanner {
  constructor(options = {}) {
    this.maxSteps = options.maxSteps || 10;
    this.enableReflection = options.enableReflection !== false;
  }

  /**
   * 规划任务
   * @param {string} task 用户任务描述
   * @param {object} context 上下文信息
   * @returns {Promise<object>} 执行计划
   */
  async plan(task, context = {}) {
    const planPrompt = `你是一个任务规划专家。分析用户请求，生成结构化的执行计划。

用户任务: ${task}

上下文信息:
- 可用工具: ${pluginManager.getToolsForFunctionCalling().map(t => t.function.name).join(', ')}
- 当前目录: ${context.cwd || process.cwd()}

请生成执行计划，格式如下:
\`\`\`json
{
  "goal": "任务目标",
  "steps": [
    { "id": 1, "action": "动作描述", "tool": "工具名称", "expected": "预期结果" },
    { "id": 2, "action": "动作描述", "tool": "工具名称", "expected": "预期结果" }
  ],
  "success_criteria": "成功标准"
}
\`\`\`

注意:
1. 每个步骤应该是原子操作
2. 优先使用可用的工具
3. 如果任务复杂，拆分为多个步骤
4. 返回纯 JSON，不要有其他内容`;

    const provider = this.getProvider(context);
    const model = this.getModel(context);

    const response = await provider.chat(model, [
      { role: 'system', content: '你是一个精准的任务规划专家，只返回 JSON 格式的计划。' },
      { role: 'user', content: planPrompt }
    ]);

    // 解析计划
    const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      response.content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        const plan = JSON.parse(jsonMatch[1] || jsonMatch[0]);
        plan.taskId = crypto.randomUUID();
        plan.createdAt = Date.now();
        return plan;
      } catch (e) {
        logger.warn('[Planner] Failed to parse plan:', e.message);
      }
    }

    // 降级：生成简单计划
    return this.generateSimplePlan(task);
  }

  /**
   * 执行计划
   * @param {object} plan 执行计划
   * @param {object} context 执行上下文
   * @param {function} onProgress 进度回调
   * @returns {Promise<object>} 执行结果
   */
  async execute(plan, context = {}, onProgress = () => {}) {
    const results = [];
    let allSuccess = true;

    onProgress({ phase: 'execute', plan });

    for (const step of plan.steps) {
      onProgress({ phase: 'step', step });

      const result = await this.executeStep(step, context);

      results.push({
        stepId: step.id,
        action: step.action,
        tool: step.tool,
        success: result.success,
        result: result.result || result.error
      });

      if (!result.success) {
        allSuccess = false;
        // 检查是否需要中断
        if (step.critical !== false) {
          onProgress({ phase: 'failed', step, result });
          break;
        }
      }

      onProgress({ phase: 'step_done', step, result });
    }

    return {
      taskId: plan.taskId,
      goal: plan.goal,
      success: allSuccess,
      results,
      completedAt: Date.now()
    };
  }

  /**
   * 执行单个步骤
   */
  async executeStep(step, context) {
    const tool = step.tool;

    // 如果没有指定工具，尝试推断
    if (!tool) {
      return { success: false, error: 'No tool specified' };
    }

    // 从步骤描述中提取参数
    const args = this.extractArgs(step);

    try {
      const result = await pluginManager.executeTool(tool, args, context);
      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 从步骤描述中提取参数
   */
  extractArgs(step) {
    const args = {};

    // 如果步骤有 args 字段
    if (step.args) {
      return step.args;
    }

    // 根据工具类型推断参数
    switch (step.tool) {
      case 'run_command':
        // 从 action 中提取命令
        const cmdMatch = step.action.match(/(?:执行|运行|run)\s*[`"]?([^`"\n]+)[`"]?/i);
        if (cmdMatch) args.command = cmdMatch[1].trim();
        break;

      case 'read_file':
        const pathMatch = step.action.match(/(?:读取|read)\s*[`"]?([^`"\n]+)[`"]?/i);
        if (pathMatch) args.path = pathMatch[1].trim();
        break;

      case 'write_file':
        const writeMatch = step.action.match(/(?:写入|write)\s*[`"]?([^`"\n]+)[`"]?/i);
        if (writeMatch) args.path = writeMatch[1].trim();
        if (step.content) args.content = step.content;
        break;

      case 'git_commit':
        const msgMatch = step.action.match(/(?:提交|commit)\s*[`"]?([^`"\n]+)[`"]?/i);
        if (msgMatch) args.message = msgMatch[1].trim();
        break;
    }

    return args;
  }

  /**
   * 反思执行结果，决定是否需要调整
   */
  async reflect(plan, executionResult, context = {}) {
    if (!this.enableReflection) {
      return { needsAdjustment: false };
    }

    const reflectPrompt = `分析任务执行结果，判断是否需要调整计划。

原始任务: ${plan.goal}

执行结果:
${JSON.stringify(executionResult.results, null, 2)}

成功标准: ${plan.success_criteria}

请评估:
1. 任务是否完成?
2. 如果未完成，需要什么调整?
3. 是否需要重新规划?

返回 JSON:
\`\`\`json
{
  "completed": true/false,
  "score": 1-5,
  "feedback": "反馈",
  "needsAdjustment": true/false,
  "adjustments": [
    { "stepId": 1, "newAction": "新动作" }
  ]
}
\`\`\``;

    const provider = this.getProvider(context);
    const model = this.getModel(context);

    const response = await provider.chat(model, [
      { role: 'system', content: '你是任务评估专家，只返回 JSON。' },
      { role: 'user', content: reflectPrompt }
    ]);

    const jsonMatch = response.content.match(/```json\s*([\s\S]*?)\s*```/) ||
                      response.content.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } catch (e) {
        return { needsAdjustment: false, feedback: 'Reflection parse failed' };
      }
    }

    return { needsAdjustment: false };
  }

  /**
   * 完整的 Plan-Execute-Reflect 循环
   */
  async run(task, context = {}, onProgress = () => {}) {
    // 1. Plan
    onProgress({ phase: 'planning' });
    const plan = await this.plan(task, context);
    onProgress({ phase: 'planned', plan });

    // 2. Execute
    onProgress({ phase: 'executing' });
    let result = await this.execute(plan, context, onProgress);

    // 3. Reflect
    if (this.enableReflection && !result.success) {
      onProgress({ phase: 'reflecting' });
      const reflection = await this.reflect(plan, result, context);

      if (reflection.needsAdjustment && reflection.adjustments) {
        // 调整计划
        onProgress({ phase: 'adjusting', reflection });
        plan.steps = plan.steps.map(step => {
          const adj = reflection.adjustments.find(a => a.stepId === step.id);
          return adj ? { ...step, ...adj } : step;
        });

        // 重新执行
        result = await this.execute(plan, context, onProgress);
      }

      result.reflection = reflection;
    }

    onProgress({ phase: 'done', result });
    return result;
  }

  /**
   * 生成简单计划（降级方案）
   */
  generateSimplePlan(task) {
    return {
      taskId: crypto.randomUUID(),
      goal: task,
      steps: [
        { id: 1, action: task, tool: 'run_command', expected: '完成用户请求' }
      ],
      success_criteria: '用户满意',
      createdAt: Date.now()
    };
  }

  /**
   * 获取当前 Provider
   */
  getProvider(context) {
    const providerId = context.providerId ||
                       sessionManager.currentProvider ||
                       'openrouter';
    return sessionManager.getProvider(providerId);
  }

  /**
   * 获取当前 Model
   */
  getModel(context) {
    return context.model || sessionManager.currentModel || 'auto';
  }
}

export const taskPlanner = new TaskPlanner();
