import logger from '../logger.js';
/**
 * 策略优化器
 * 基于经验调整策略，实现自主优化
 */

export class StrategyOptimizer {
  constructor(options = {}) {
    this.strategies = new Map();
    this.optimizationHistory = [];
    this.performanceMetrics = new Map();
    
    this.learningRate = options.learningRate || 0.1; // 学习速率
    this.explorationRate = options.explorationRate || 0.1; // 探索率
    this.optimizationThreshold = options.optimizationThreshold || 0.05; // 优化阈值
    this.maxHistory = options.maxHistory || 100; // 最大历史记录
    this.improvementWindow = options.improvementWindow || 10; // 改进窗口
    
    // 优化策略类型
    this.optimizerTypes = {
      E_GREEDY: 'e_greedy', // ε-贪婪
      UCB: 'ucb', // 上置信区间
      THOMPSON_SAMPLING: 'thompson_sampling', // 汤普森采样
      GRADIENT_ASCENT: 'gradient_ascent', // 梯度上升
      EVOLUTIONARY: 'evolutionary' // 进化算法
    };
    
    this.currentOptimizer = options.optimizerType || this.optimizerTypes.E_GREEDY;
  }

  /**
   * 注册策略
   */
  registerStrategy(strategyId, strategyConfig) {
    const strategy = {
      id: strategyId,
      config: strategyConfig,
      parameters: strategyConfig.parameters || {},
      performance: {
        totalExecutions: 0,
        successfulExecutions: 0,
        avgReward: 0,
        totalReward: 0,
        rewardHistory: [],
        executionTimes: [],
        lastUpdated: Date.now()
      },
      optimizationHistory: [],
      isActive: true
    };
    
    this.strategies.set(strategyId, strategy);
    
    logger.info(`[StrategyOptimizer] Registered strategy: ${strategyId}`, strategyConfig);
    
    return strategyId;
  }

  /**
   * 评估策略性能
   */
  evaluatePerformance(strategyId, result) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }
    
    // 计算奖励
    const reward = this._calculateReward(result);
    
    // 更新性能指标
    strategy.performance.totalExecutions++;
    strategy.performance.totalReward += reward;
    strategy.performance.avgReward = strategy.performance.totalReward / strategy.performance.totalExecutions;
    
    if (result.success) {
      strategy.performance.successfulExecutions++;
    }
    
    // 记录历史
    strategy.performance.rewardHistory.push({
      reward,
      timestamp: Date.now(),
      executionTime: result.executionTime || 0,
      success: result.success
    });
    
    // 限制历史记录大小
    if (strategy.performance.rewardHistory.length > this.maxHistory) {
      strategy.performance.rewardHistory.shift();
    }
    
    // 记录执行时间
    strategy.performance.executionTimes.push(result.executionTime || 0);
    if (strategy.performance.executionTimes.length > this.maxHistory) {
      strategy.performance.executionTimes.shift();
    }
    
    strategy.performance.lastUpdated = Date.now();
    
    // 检查是否需要优化
    this._checkOptimizationOpportunity(strategy);
    
    logger.info(`[StrategyOptimizer] Evaluated strategy ${strategyId} - Reward: ${reward}, Success: ${result.success}`);
  }

  /**
   * 计算奖励
   */
  _calculateReward(result) {
    // 奖励函数：基于成功、效率等因素
    let reward = 0;
    
    if (result.success) {
      reward += 1.0; // 成功奖励
      
      // 时间效率奖励：更快完成获得更多奖励
      if (result.executionTime && result.executionTime > 0) {
        // 基于执行时间的逆向奖励（时间越短奖励越高）
        reward += Math.max(0, 1.0 - (result.executionTime / 10000)); // 基于10秒标准
      }
      
      // 资源效率奖励
      if (result.resourceUsage) {
        const cpuUsage = result.resourceUsage.cpu || 0;
        const memoryUsage = result.resourceUsage.memory || 0;
        
        // 低资源使用获得奖励
        reward += Math.max(0, (1.0 - cpuUsage) * 0.1);
        reward += Math.max(0, (1.0 - memoryUsage) * 0.1);
      }
    } else {
      reward -= 1.0; // 失败惩罚
    }
    
    return Math.max(-1.0, Math.min(2.0, reward)); // 限制奖励范围 [-1, 2]
  }

  /**
   * 检查优化机会
   */
  _checkOptimizationOpportunity(strategy) {
    if (strategy.performance.rewardHistory.length < 5) {
      return; // 需要足够的历史数据
    }
    
    // 计算近期性能趋势
    const recentRewards = strategy.performance.rewardHistory.slice(-5).map(r => r.reward);
    const avgRecent = recentRewards.reduce((a, b) => a + b, 0) / recentRewards.length;
    
    // 计算整体平均奖励
    const overallAvg = strategy.performance.avgReward;
    
    // 如果近期表现显著低于整体表现，则考虑优化
    if (avgRecent < overallAvg - this.optimizationThreshold) {
      this._optimizeStrategy(strategy);
    }
  }

  /**
   * 优化策略
   */
  _optimizeStrategy(strategy) {
    // 根据当前优化器类型选择不同的优化策略
    switch (this.currentOptimizer) {
      case this.optimizerTypes.E_GREEDY:
        this._optimizeEGreedy(strategy);
        break;
      case this.optimizerTypes.UCB:
        this._optimizeUCB(strategy);
        break;
      case this.optimizerTypes.GRADIENT_ASCENT:
        this._optimizeGradientAscent(strategy);
        break;
      default:
        this._optimizeEGreedy(strategy);
        break;
    }
    
    // 记录优化历史
    strategy.optimizationHistory.push({
      timestamp: Date.now(),
      previousParameters: { ...strategy.parameters },
      optimizationType: this.currentOptimizer,
      reason: 'Performance degradation detected'
    });
    
    // 限制优化历史大小
    if (strategy.optimizationHistory.length > this.maxHistory) {
      strategy.optimizationHistory.shift();
    }
    
    logger.info(`[StrategyOptimizer] Optimized strategy: ${strategy.id}`);
  }

  /**
   * ε-贪婪优化
   */
  _optimizeEGreedy(strategy) {
    // 随机选择一部分参数进行小幅度调整
    const paramsToAdjust = Object.keys(strategy.parameters);
    
    for (const paramName of paramsToAdjust) {
      const currentValue = strategy.parameters[paramName];
      
      // 有一定概率随机调整参数
      if (Math.random() < this.explorationRate) {
        // 随机调整参数值（在合理范围内）
        const adjustment = (Math.random() - 0.5) * 0.1; // ±5% 调整
        const newValue = currentValue + adjustment;
        
        // 确保参数在合理范围内
        strategy.parameters[paramName] = Math.max(0, Math.min(1, newValue));
      }
    }
  }

  /**
   * 梯度上升优化
   */
  _optimizeGradientAscent(strategy) {
    // 基于奖励历史计算梯度
    const history = strategy.performance.rewardHistory;
    if (history.length < 2) return;
    
    // 计算奖励的变化趋势
    const recentChange = history[history.length - 1].reward - history[history.length - 2].reward;
    
    // 对每个参数应用梯度更新
    for (const paramName of Object.keys(strategy.parameters)) {
      const gradient = recentChange * this.learningRate;
      const currentValue = strategy.parameters[paramName];
      const newValue = currentValue + gradient;
      
      // 确保参数在合理范围内
      strategy.parameters[paramName] = Math.max(0, Math.min(1, newValue));
    }
  }

  /**
   * 获取最佳策略
   */
  getBestStrategy(taskType = null) {
    let bestStrategy = null;
    let bestScore = -Infinity;
    
    for (const strategy of this.strategies.values()) {
      if (!strategy.isActive) continue;
      
      // 如果指定了任务类型，只考虑适用于该类型的策略
      if (taskType && !this._isStrategySuitableForTask(strategy, taskType)) {
        continue;
      }
      
      // 计算策略分数（基于平均奖励和成功率）
      const score = this._calculateStrategyScore(strategy);
      
      if (score > bestScore) {
        bestScore = score;
        bestStrategy = strategy;
      }
    }
    
    return bestStrategy;
  }

  /**
   * 计算策略分数
   */
  _calculateStrategyScore(strategy) {
    const successRate = strategy.performance.totalExecutions > 0 
      ? strategy.performance.successfulExecutions / strategy.performance.totalExecutions 
      : 0;
    
    // 综合考虑平均奖励和成功率
    return strategy.performance.avgReward * 0.7 + successRate * 0.3;
  }

  /**
   * 检查策略是否适用于任务类型
   */
  _isStrategySuitableForTask(strategy, taskType) {
    const applicableTasks = strategy.config.applicableTasks || [];
    return applicableTasks.length === 0 || applicableTasks.includes(taskType);
  }

  /**
   * 选择策略（带探索）
   */
  selectStrategy(taskType = null, options = {}) {
    // 根据当前优化器类型选择策略
    switch (this.currentOptimizer) {
      case this.optimizerTypes.E_GREEDY:
        return this._selectEGreedyStrategy(taskType, options);
      case this.optimizerTypes.UCB:
        return this._selectUCBStrategy(taskType, options);
      case this.optimizerTypes.THOMPSON_SAMPLING:
        return this._selectThompsonSamplingStrategy(taskType, options);
      default:
        return this._selectEGreedyStrategy(taskType, options);
    }
  }

  /**
   * ε-贪婪策略选择
   */
  _selectEGreedyStrategy(taskType, options = {}) {
    if (Math.random() < this.explorationRate) {
      // 探索：随机选择策略
      const applicableStrategies = Array.from(this.strategies.values())
        .filter(s => s.isActive && (!taskType || this._isStrategySuitableForTask(s, taskType)));
      
      if (applicableStrategies.length > 0) {
        return applicableStrategies[Math.floor(Math.random() * applicableStrategies.length)];
      }
    }
    
    // 利用：选择最佳策略
    return this.getBestStrategy(taskType);
  }

  /**
   * UCB策略选择
   */
  _selectUCBStrategy(taskType, options = {}) {
    let bestStrategy = null;
    let bestUCBValue = -Infinity;
    
    for (const strategy of this.strategies.values()) {
      if (!strategy.isActive) continue;
      if (taskType && !this._isStrategySuitableForTask(strategy, taskType)) continue;
      
      // 计算UCB值
      const ucbValue = this._calculateUCBValue(strategy);
      
      if (ucbValue > bestUCBValue) {
        bestUCBValue = ucbValue;
        bestStrategy = strategy;
      }
    }
    
    return bestStrategy;
  }

  /**
   * 计算UCB值
   */
  _calculateUCBValue(strategy) {
    if (strategy.performance.totalExecutions === 0) {
      return Infinity; // 从未执行过的策略给予最高优先级
    }
    
    const avgReward = strategy.performance.avgReward;
    const totalExecutions = Array.from(this.strategies.values())
      .reduce((sum, s) => sum + s.performance.totalExecutions, 0);
    
    // UCB公式: 平均奖励 + 探索项
    const explorationTerm = Math.sqrt((2 * Math.log(totalExecutions)) / strategy.performance.totalExecutions);
    
    return avgReward + this.explorationRate * explorationTerm;
  }

  /**
   * 获取策略参数
   */
  getStrategyParameters(strategyId) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      return null;
    }
    
    return { ...strategy.parameters };
  }

  /**
   * 更新策略参数
   */
  updateStrategyParameters(strategyId, newParameters) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }
    
    strategy.parameters = { ...strategy.parameters, ...newParameters };
    
    // 记录参数变更
    strategy.optimizationHistory.push({
      timestamp: Date.now(),
      previousParameters: { ...strategy.parameters },
      newParameters,
      optimizationType: 'manual_update',
      reason: 'Manual parameter update'
    });
    
    // 限制优化历史大小
    if (strategy.optimizationHistory.length > this.maxHistory) {
      strategy.optimizationHistory.shift();
    }
  }

  /**
   * 启用/禁用策略
   */
  setStrategyActive(strategyId, active) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }
    
    strategy.isActive = active;
  }

  /**
   * 进行A/B测试
   */
  async conductABTest(strategyAId, strategyBId, testConfig) {
    const strategyA = this.strategies.get(strategyAId);
    const strategyB = this.strategies.get(strategyBId);
    
    if (!strategyA || !strategyB) {
      throw new Error('Both strategies must exist for A/B test');
    }
    
    const results = {
      strategyA: { id: strategyAId, wins: 0, total: 0, avgReward: 0 },
      strategyB: { id: strategyBId, wins: 0, total: 0, avgReward: 0 },
      totalTests: testConfig.testCount || 100
    };
    
    for (let i = 0; i < results.totalTests; i++) {
      // 执行测试任务
      const testResultA = await this._executeTestTask(strategyA, testConfig);
      const testResultB = await this._executeTestTask(strategyB, testConfig);
      
      results.strategyA.total++;
      results.strategyB.total++;
      
      results.strategyA.avgReward = 
        ((results.strategyA.avgReward * (results.strategyA.total - 1)) + testResultA.reward) / results.strategyA.total;
      results.strategyB.avgReward = 
        ((results.strategyB.avgReward * (results.strategyB.total - 1)) + testResultB.reward) / results.strategyB.total;
      
      if (testResultA.reward > testResultB.reward) {
        results.strategyA.wins++;
      } else if (testResultB.reward > testResultA.reward) {
        results.strategyB.wins++;
      }
    }
    
    // 记录测试结果
    this.optimizationHistory.push({
      type: 'ab_test',
      timestamp: Date.now(),
      results,
      config: testConfig
    });
    
    // 限制历史记录大小
    if (this.optimizationHistory.length > this.maxHistory) {
      this.optimizationHistory.shift();
    }
    
    return results;
  }

  /**
   * 执行测试任务
   */
  _executeTestTask(strategy, testConfig) {
    // 模拟测试任务执行
    return new Promise(resolve => {
      setTimeout(() => {
        // 基于策略参数和随机因素生成测试结果
        const baseReward = Math.random() * 2 - 0.5; // -0.5 to 1.5
        const parameterEffect = Object.values(strategy.parameters).reduce((sum, val) => sum + val, 0) * 0.5;
        const reward = Math.max(-1, Math.min(2, baseReward + parameterEffect));
        
        resolve({
          reward,
          success: reward > 0,
          executionTime: 100 + Math.random() * 50
        });
      }, 10 + Math.random() * 20); // 10-30ms 模拟执行时间
    });
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics(strategyId = null) {
    if (strategyId) {
      const strategy = this.strategies.get(strategyId);
      return strategy ? strategy.performance : null;
    }
    
    // 返回所有策略的性能指标摘要
    const summary = {};
    for (const [id, strategy] of this.strategies) {
      summary[id] = {
        totalExecutions: strategy.performance.totalExecutions,
        successfulExecutions: strategy.performance.successfulExecutions,
        successRate: strategy.performance.totalExecutions > 0 
          ? (strategy.performance.successfulExecutions / strategy.performance.totalExecutions * 100).toFixed(2) + '%' 
          : '0%',
        avgReward: parseFloat(strategy.performance.avgReward.toFixed(4)),
        lastUpdated: strategy.performance.lastUpdated
      };
    }
    
    return summary;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalStrategies: this.strategies.size,
      activeStrategies: Array.from(this.strategies.values()).filter(s => s.isActive).length,
      optimizationHistoryCount: this.optimizationHistory.length,
      totalHistory: this.optimizationHistory.length,
      learningRate: this.learningRate,
      explorationRate: this.explorationRate,
      optimizerType: this.currentOptimizer
    };
  }

  /**
   * 重置策略性能
   */
  resetStrategyPerformance(strategyId) {
    const strategy = this.strategies.get(strategyId);
    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }
    
    strategy.performance = {
      totalExecutions: 0,
      successfulExecutions: 0,
      avgReward: 0,
      totalReward: 0,
      rewardHistory: [],
      executionTimes: [],
      lastUpdated: Date.now()
    };
  }

  /**
   * 清理资源
   */
  cleanup() {
    // 清理过期的历史记录
    for (const strategy of this.strategies.values()) {
      if (strategy.performance.rewardHistory.length > this.maxHistory) {
        strategy.performance.rewardHistory = strategy.performance.rewardHistory.slice(-this.maxHistory);
      }
      
      if (strategy.performance.executionTimes.length > this.maxHistory) {
        strategy.performance.executionTimes = strategy.performance.executionTimes.slice(-this.maxHistory);
      }
      
      if (strategy.optimizationHistory.length > this.maxHistory) {
        strategy.optimizationHistory = strategy.optimizationHistory.slice(-this.maxHistory);
      }
    }
    
    if (this.optimizationHistory.length > this.maxHistory) {
      this.optimizationHistory = this.optimizationHistory.slice(-this.maxHistory);
    }
  }
}

// 默认导出
export default StrategyOptimizer;