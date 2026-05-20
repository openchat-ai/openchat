import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '../core/model-selection.json');

/**
 * 模型选择器 - 根据任务复杂度智能选择模型和配置
 */
export class ModelSelector {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, 'utf8');
        return JSON.parse(data);
      }
    } catch (e) {
      logger.error('[ModelSelector] Failed to load config:', e.message);
    }
    return this.getDefaultConfig();
  }

  getDefaultConfig() {
    return {
      modelSelection: {
        anthropic: {
          defaultModel: '[按次]claude-sonnet-4-5',
          smallFastModel: '[按次]claude-haiku-4-5',
          defaultHaikuModel: '[按次]claude-haiku-4-5',
          defaultSonnetModel: '[按次]claude-sonnet-4-5',
          defaultOpusModel: '[按次]claude-opus-4-6'
        },
        strategy: {
          modelSelectionStrategy: 'dynamic',
          simpleTaskModel: 'haiku',
          defaultTaskModel: 'sonnet',
          complexTaskModel: 'opus',
          thinkingEnabledForComplex: true,
          thinkingThreshold: 3
        }
      }
    };
  }

  /**
   * 根据任务复杂度选择模型
   * @param {number} complexity 复杂度 (1-5)
   * @param {string} taskType 任务类型
   * @returns {object} 模型配置
   */
  selectModel(complexity = 3, taskType = 'general') {
    const { anthropic, strategy } = this.config.modelSelection;

    let modelKey = strategy.defaultTaskModel; // 默认 sonnet
    let useThinking = false;

    // 基于复杂度选择模型
    if (complexity <= 2) {
      modelKey = strategy.simpleTaskModel; // haiku
    } else if (complexity >= 4 && complexity <= 5) {
      modelKey = strategy.complexTaskModel; // opus
      useThinking = strategy.thinkingEnabledForComplex;
    }

    // 特殊任务类型覆盖
    const projectConfig = this.config.modelSelection.projectSpecific || {};
    if (projectConfig[taskType]) {
      const spec = projectConfig[taskType];
      modelKey = spec.recommendedModel || modelKey;
      useThinking = spec.thinking !== undefined ? spec.thinking : useThinking;
    }

    // 获取具体的模型标识
    let modelId;
    switch (modelKey) {
      case 'haiku':
        modelId = anthropic.defaultHaikuModel || anthropic.smallFastModel;
        break;
      case 'sonnet':
        modelId = anthropic.defaultSonnetModel || anthropic.defaultModel;
        break;
      case 'opus':
        modelId = anthropic.defaultOpusModel;
        break;
      default:
        modelId = anthropic.defaultModel;
    }

    return {
      model: modelId,
      modelType: modelKey,
      useThinking,
      complexity,
      taskType,
      config: {
        maxTokens: this.getMaxTokens(modelKey),
        temperature: this.getTemperature(modelKey, taskType),
        thinking: useThinking ? this.getThinkingConfig(complexity) : null
      }
    };
  }

  /**
   * 获取模型的最大token数
   */
  getMaxTokens(modelType) {
    const limits = {
      haiku: 4096,
      sonnet: 8192,
      opus: 16384
    };
    return limits[modelType] || 4096;
  }

  /**
   * 获取温度参数
   */
  getTemperature(modelType, taskType) {
    // 代码生成和严谨任务使用较低温度
    if (taskType.includes('code') || taskType.includes('verification')) {
      return 0.2;
    }

    // 创意任务使用较高温度
    if (taskType.includes('creative') || taskType.includes('brainstorm')) {
      return 0.8;
    }

    // 模型类型默认温度
    const defaults = {
      haiku: 0.7,
      sonnet: 0.5,
      opus: 0.3
    };
    return defaults[modelType] || 0.5;
  }

  /**
   * 获取thinking参数配置
   */
  getThinkingConfig(complexity) {
    // thinking强度随复杂度增加
    const levels = {
      1: { type: 'enabled', budget_tokens: 1024 },
      2: { type: 'enabled', budget_tokens: 1024 },
      3: { type: 'enabled', budget_tokens: 2048 },
      4: { type: 'enabled', budget_tokens: 4096 },
      5: { type: 'enabled', budget_tokens: 8192 }
    };
    return levels[complexity] || levels[3];
  }

  /**
   * 评估任务复杂度
   * @param {string} taskDescription 任务描述
   * @param {string} taskType 任务类型
   * @returns {number} 复杂度分数 1-5
   */
  evaluateComplexity(taskDescription, taskType = 'general') {
    let score = 3; // 默认中等复杂度

    // 基于任务类型调整
    const typeScores = {
      'simple_query': 1,
      'status_check': 1,
      'chat': 2,
      'tool_execution': 3,
      'code_generation': 4,
      'code_review': 4,
      'architecture_design': 5,
      'complex_algorithm': 5,
      'self_verification': 4,
      'ai_person_reasoning': 4
    };

    if (typeScores[taskType]) {
      score = typeScores[taskType];
    }

    // 基于描述长度和关键词调整
    const words = taskDescription.split(/\s+/).length;
    if (words > 100) score = Math.min(5, score + 1);
    if (words < 20) score = Math.max(1, score - 1);

    // 关键词检测
    const complexityKeywords = [
      { pattern: /complex|complicated|difficult|hard/, add: 1 },
      { pattern: /simple|easy|quick|fast/, sub: 1 },
      { pattern: /algorithm|architecture|design|system/, add: 1 },
      { pattern: /verify|validate|check|test/, add: 0.5 },
      { pattern: /think|reason|analyze|plan/, add: 0.5 }
    ];

    const lowerDesc = taskDescription.toLowerCase();
    for (const { pattern, add, sub } of complexityKeywords) {
      if (pattern.test(lowerDesc)) {
        if (add) score = Math.min(5, score + add);
        if (sub) score = Math.max(1, score - sub);
      }
    }

    return Math.max(1, Math.min(5, Math.round(score)));
  }

  /**
   * 获取项目特定建议
   * @param {string} component 组件名称
   * @returns {object} 建议配置
   */
  getProjectRecommendation(component) {
    const projectConfig = this.config.modelSelection.projectSpecific || {};
    return projectConfig[component] || {
      recommendedModel: 'sonnet',
      reason: '默认推荐使用sonnet作为平衡选择'
    };
  }

  /**
   * 获取成本优化统计
   */
  getCostStatistics() {
    const strategy = this.config.modelSelection.strategy || {};
    return {
      haikuPercentage: strategy.costOptimization?.haikuPercentage || 15,
      sonnetPercentage: strategy.costOptimization?.sonnetPercentage || 80,
      opusPercentage: strategy.costOptimization?.opusPercentage || 5,
      estimatedSavings: '使用分层策略可降低15-30%成本'
    };
  }
}

// 单例实例
export const modelSelector = new ModelSelector();