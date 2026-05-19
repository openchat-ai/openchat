/**
 * 快速集成版 MultiModelTester
 * 核心功能：多模型测试框架
 */

class MultiModelTester {
  constructor() {
    // 支持的模型列表
    this.models = [
      { name: 'claude-3-5-sonnet', provider: 'Anthropic', cost: 'medium' },
      { name: 'gpt-4-turbo', provider: 'OpenAI', cost: 'high' },
      { name: 'gemini-1-5-pro', provider: 'Google', cost: 'medium' },
      { name: 'glm-4-turbo', provider: '智谱', cost: 'low' },
      { name: 'ernie-4-0', provider: '百度', cost: 'low' },
      { name: 'llama2', provider: 'Meta/Ollama', cost: 'free' },
    ];

    this.results = [];
    this.baseline = null;
  }

  /**
   * 设置基准模型
   * @param {string} modelName - 模型名称
   */
  setBaseline(modelName) {
    const model = this.models.find(m => m.name === modelName);
    if (!model) {
      throw new Error(`Model ${modelName} not found`);
    }
    this.baseline = modelName;
  }

  /**
   * 测试单个模型
   * @param {string} modelName - 模型名称
   * @param {string} prompt - 测试提示词
   * @returns {object} 测试结果
   */
  testModel(modelName, prompt) {
    const model = this.models.find(m => m.name === modelName);
    if (!model) {
      throw new Error(`Model ${modelName} not found`);
    }

    // 模拟模型响应（实际应调用真实API）
    const response = `Response from ${modelName}: Processed prompt successfully`;
    const latency = Math.random() * 2000 + 100; // 100-2100ms

    const result = {
      timestamp: new Date().toISOString(),
      model: modelName,
      prompt: prompt,
      response,
      latency,
      success: true,
      cost: this.estimateCost(model),
    };

    this.results.push(result);
    return result;
  }

  /**
   * 交叉验证多个模型
   * @param {string} prompt - 测试提示词
   * @param {Array<string>} modelNames - 模型名称数组（可选）
   * @returns {object} 交叉验证结果
   */
  crossValidate(prompt, modelNames = null) {
    const modelsToTest = modelNames
      ? this.models.filter(m => modelNames.includes(m.name))
      : this.models;

    const results = modelsToTest.map(model => this.testModel(model.name, prompt));

    return {
      timestamp: new Date().toISOString(),
      prompt,
      modelCount: results.length,
      results,
      consensus: this.calculateConsensus(results),
      averageLatency: results.reduce((sum, r) => sum + r.latency, 0) / results.length,
      averageCost: results.reduce((sum, r) => sum + r.cost, 0) / results.length,
    };
  }

  /**
   * 与基准模型对比
   * @param {string} prompt - 测试提示词
   * @returns {object} 对比结果
   */
  compareWithBaseline(prompt) {
    if (!this.baseline) {
      throw new Error('Baseline model not set');
    }

    const baselineResult = this.testModel(this.baseline, prompt);
    const otherModels = this.models.filter(m => m.name !== this.baseline);

    const comparisonResults = otherModels.map(model => {
      const result = this.testModel(model.name, prompt);
      return {
        model: model.name,
        latencyDiff: result.latency - baselineResult.latency,
        costDiff: result.cost - baselineResult.cost,
        speedRatio: baselineResult.latency / result.latency,
      };
    });

    return {
      timestamp: new Date().toISOString(),
      baseline: this.baseline,
      prompt,
      baselineLatency: baselineResult.latency,
      comparisons: comparisonResults,
      fastestModel: comparisonResults.reduce((best, current) =>
        current.speedRatio > best.speedRatio ? current : best
      ).model,
      cheapestModel: comparisonResults.reduce((best, current) =>
        current.costDiff < best.costDiff ? current : best
      ).model,
    };
  }

  /**
   * 推荐最优模型
   * @param {object} preferences - 偏好设置 { prioritize: 'speed'|'cost'|'quality' }
   * @returns {object} 推荐结果
   */
  recommendModel(preferences = {}) {
    const { prioritize = 'quality' } = preferences;

    let recommended = this.models[0];

    if (prioritize === 'speed') {
      // 优先选择本地模型（Llama2）
      recommended = this.models.find(m => m.name === 'llama2') || recommended;
    } else if (prioritize === 'cost') {
      // 优先选择成本低的模型
      recommended = this.models.find(m => m.cost === 'free') ||
                    this.models.find(m => m.cost === 'low') ||
                    recommended;
    } else {
      // 默认优先选择质量（Claude）
      recommended = this.models.find(m => m.name === 'claude-3-5-sonnet') || recommended;
    }

    return {
      timestamp: new Date().toISOString(),
      recommended: recommended.name,
      provider: recommended.provider,
      cost: recommended.cost,
      rationale: this.getRecommendationRationale(recommended, prioritize),
    };
  }

  /**
   * 计算共识
   * @param {Array} results - 模型结果数组
   * @returns {string} 共识描述
   */
  calculateConsensus(results) {
    const successCount = results.filter(r => r.success).length;
    const consensus = (successCount / results.length * 100).toFixed(1);
    return `${consensus}% 模型成功`;
  }

  /**
   * 估算成本
   * @param {object} model - 模型对象
   * @returns {number} 估算成本
   */
  estimateCost(model) {
    const costMap = {
      free: 0,
      low: 0.01,
      medium: 0.05,
      high: 0.1,
    };
    return costMap[model.cost] || 0;
  }

  /**
   * 获取推荐理由
   * @param {object} model - 模型对象
   * @param {string} prioritize - 优先级
   * @returns {string} 理由
   */
  getRecommendationRationale(model, prioritize) {
    const reasons = {
      speed: `${model.name} 作为本地模型，性能最佳`,
      cost: `${model.name} 的成本最低（${model.cost}）`,
      quality: `${model.name} 提供最高质量的输出`,
    };
    return reasons[prioritize] || reasons.quality;
  }

  /**
   * 获取所有结果
   * @returns {Array} 所有测试结果
   */
  getResults() {
    return this.results;
  }

  /**
   * 获取模型列表
   * @returns {Array} 模型列表
   */
  getModels() {
    return this.models.map(m => ({
      name: m.name,
      provider: m.provider,
      cost: m.cost,
    }));
  }

  /**
   * 清空结果
   */
  clearResults() {
    this.results = [];
  }
}

export default MultiModelTester;
