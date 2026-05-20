import logger from './logger.js';
/**
 * 结果聚合器
 * 汇聚多Agent协作的结果
 */

export class ResultAggregator {
  constructor(options = {}) {
    this.agents = new Map();
    this.tasks = new Map();
    this.results = new Map();
    this.aggregatedResults = new Map();
    
    this.aggregationStrategy = options.aggregationStrategy || 'consensus'; // consensus, weighted, majority, average
    this.consensusThreshold = options.consensusThreshold || 0.6; // 60%同意阈值
    this.weightingScheme = options.weightingScheme || 'uniform'; // uniform, capability-based, performance-based
  }

  /**
   * 注册Agent及其能力
   */
  registerAgent(agentId, capabilities = {}) {
    this.agents.set(agentId, {
      id: agentId,
      capabilities,
      weight: 1, // 初始权重
      performanceHistory: [],
      reputation: 1.0 // 初始声誉值
    });
    
    logger.info(`[ResultAggregator] Registered agent: ${agentId}`, capabilities);
  }

  /**
   * 提交任务结果
   */
  submitResult(taskId, agentId, result) {
    if (!this.agents.has(agentId)) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    
    if (!this.tasks.has(taskId)) {
      this.tasks.set(taskId, {
        id: taskId,
        results: [],
        aggregated: false,
        submittedAt: Date.now(),
        completedAt: null
      });
    }
    
    const task = this.tasks.get(taskId);
    const submission = {
      agentId,
      result,
      submittedAt: Date.now(),
      confidence: result.confidence || 1.0,
      metadata: result.metadata || {}
    };
    
    task.results.push(submission);
    
    // 更新Agent性能历史
    this._updateAgentPerformance(agentId, result);
    
    logger.info(`[ResultAggregator] Received result for task ${taskId} from agent ${agentId}`);
    
    // 检查是否可以聚合
    this._checkAndAggregate(taskId);
  }

  /**
   * 更新Agent性能
   */
  _updateAgentPerformance(agentId, result) {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    
    // 记录性能（这里简化为成功/失败）
    const performanceRecord = {
      result: result,
      timestamp: Date.now(),
      success: result.success !== false
    };
    
    agent.performanceHistory.push(performanceRecord);
    
    // 保留最近100条记录
    if (agent.performanceHistory.length > 100) {
      agent.performanceHistory.shift();
    }
    
    // 更新声誉（基于最近的表现）
    const recentPerformances = agent.performanceHistory.slice(-10);
    if (recentPerformances.length > 0) {
      const successRate = recentPerformances.filter(p => p.success).length / recentPerformances.length;
      agent.reputation = successRate;
    }
  }

  /**
   * 检查并聚合结果
   */
  _checkAndAggregate(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.aggregated) return;
    
    // 检查是否收到足够数量的结果
    if (task.results.length === 0) return;
    
    // 立即聚合所有结果
    const aggregatedResult = this.aggregateResults(taskId);
    task.aggregated = true;
    task.completedAt = Date.now();
    
    this.aggregatedResults.set(taskId, aggregatedResult);
    
    logger.info(`[ResultAggregator] Aggregated results for task ${taskId}`);
    
    return aggregatedResult;
  }

  /**
   * 聚合结果
   */
  aggregateResults(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.results.length === 0) {
      return { error: 'No results to aggregate' };
    }
    
    // 根据策略选择聚合方法
    switch (this.aggregationStrategy) {
      case 'consensus':
        return this._aggregateByConsensus(task.results);
      case 'weighted':
        return this._aggregateWeighted(task.results);
      case 'majority':
        return this._aggregateByMajority(task.results);
      case 'average':
        return this._aggregateByAverage(task.results);
      default:
        return this._aggregateByConsensus(task.results);
    }
  }

  /**
   * 共识聚合
   */
  _aggregateByConsensus(results) {
    // 对于数值型结果，计算平均值
    // 对于类别型结果，寻找多数意见
    const numericResults = results.filter(r => typeof r.result.value === 'number');
    const categoricalResults = results.filter(r => typeof r.result.value !== 'number');
    
    const aggregated = {};
    
    if (numericResults.length > 0) {
      // 数值型结果：加权平均
      const weightedSum = numericResults.reduce((sum, r) => {
        const weight = this._calculateWeight(r.agentId, r.confidence);
        return sum + (r.result.value * weight);
      }, 0);
      
      const totalWeight = numericResults.reduce((sum, r) => {
        return sum + this._calculateWeight(r.agentId, r.confidence);
      }, 0);
      
      if (totalWeight > 0) {
        aggregated.numericValue = weightedSum / totalWeight;
      }
    }
    
    if (categoricalResults.length > 0) {
      // 类别型结果：投票
      const votes = new Map();
      for (const r of categoricalResults) {
        const value = r.result.value || r.result.toString();
        const weight = this._calculateWeight(r.agentId, r.confidence);
        
        if (!votes.has(value)) {
          votes.set(value, 0);
        }
        votes.set(value, votes.get(value) + weight);
      }
      
      // 找到最高票数的值
      let topValue = null;
      let maxVotes = 0;
      for (const [value, voteCount] of votes) {
        if (voteCount > maxVotes) {
          maxVotes = voteCount;
          topValue = value;
        }
      }
      
      aggregated.categoricalValue = topValue;
      aggregated.votes = Object.fromEntries(votes);
      
      // 检查是否达成共识
      const totalVotes = Array.from(votes.values()).reduce((a, b) => a + b, 0);
      if (totalVotes > 0) {
        const consensusRatio = maxVotes / totalVotes;
        aggregated.consensusReached = consensusRatio >= this.consensusThreshold;
        aggregated.confidence = consensusRatio;
      }
    }
    
    aggregated.rawResults = results;
    aggregated.strategy = 'consensus';
    aggregated.timestamp = Date.now();
    
    return aggregated;
  }

  /**
   * 加权聚合
   */
  _aggregateWeighted(results) {
    // 基于Agent声誉和置信度的加权聚合
    const weights = results.map(r => this._calculateWeight(r.agentId, r.confidence));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    
    if (totalWeight === 0) {
      return { error: 'Zero total weight' };
    }
    
    const weightedResults = results.map((r, i) => {
      return {
        ...r,
        effectiveWeight: weights[i] / totalWeight
      };
    });
    
    // 计算加权平均
    const weightedSum = weightedResults.reduce((sum, r) => {
      const value = typeof r.result.value === 'number' ? r.result.value : 0;
      return sum + (value * r.effectiveWeight);
    }, 0);
    
    return {
      value: weightedSum,
      weightedResults,
      totalWeight,
      strategy: 'weighted',
      timestamp: Date.now()
    };
  }

  /**
   * 多数聚合
   */
  _aggregateByMajority(results) {
    const counts = new Map();
    for (const r of results) {
      const value = r.result.value || r.result.toString();
      if (!counts.has(value)) {
        counts.set(value, 0);
      }
      counts.set(value, counts.get(value) + 1);
    }
    
    let majorityValue = null;
    let maxCount = 0;
    for (const [value, count] of counts) {
      if (count > maxCount) {
        maxCount = count;
        majorityValue = value;
      }
    }
    
    return {
      majorityValue,
      counts: Object.fromEntries(counts),
      totalResults: results.length,
      strategy: 'majority',
      timestamp: Date.now()
    };
  }

  /**
   * 平均聚合
   */
  _aggregateByAverage(results) {
    const numericResults = results
      .map(r => typeof r.result.value === 'number' ? r.result.value : null)
      .filter(val => val !== null);
    
    if (numericResults.length === 0) {
      return { error: 'No numeric values to average' };
    }
    
    const sum = numericResults.reduce((a, b) => a + b, 0);
    const average = sum / numericResults.length;
    
    return {
      average,
      values: numericResults,
      count: numericResults.length,
      strategy: 'average',
      timestamp: Date.now()
    };
  }

  /**
   * 计算权重
   */
  _calculateWeight(agentId, confidence = 1.0) {
    const agent = this.agents.get(agentId);
    if (!agent) return 1.0;
    
    let weight = 1.0;
    
    switch (this.weightingScheme) {
      case 'capability-based':
        // 基于能力的权重
        weight = Object.keys(agent.capabilities).length || 1;
        break;
      case 'performance-based':
        // 基于性能的权重
        weight = agent.reputation;
        break;
      case 'uniform':
      default:
        // 统一权重
        weight = 1.0;
        break;
    }
    
    // 结合置信度
    return weight * confidence;
  }

  /**
   * 获取聚合结果
   */
  getAggregatedResult(taskId) {
    return this.aggregatedResults.get(taskId);
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
      resultCount: task.results.length,
      aggregated: task.aggregated,
      submittedAt: task.submittedAt,
      completedAt: task.completedAt,
      results: task.results
    };
  }

  /**
   * 获取Agent统计
   */
  getAgentStats(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    
    return {
      id: agent.id,
      capabilities: agent.capabilities,
      weight: agent.weight,
      reputation: agent.reputation,
      performanceHistoryLength: agent.performanceHistory.length,
      recentPerformance: agent.performanceHistory.slice(-5)
    };
  }

  /**
   * 获取聚合统计
   */
  getStats() {
    const completedTasks = Array.from(this.aggregatedResults.keys()).length;
    const totalTasks = this.tasks.size;
    
    return {
      totalTasks,
      completedTasks,
      aggregatedTaskCount: this.aggregatedResults.size,
      registeredAgents: this.agents.size,
      aggregationStrategy: this.aggregationStrategy,
      consensusThreshold: this.consensusThreshold
    };
  }

  /**
   * 清理过期数据
   */
  cleanup(olderThanMs = 3600000) { // 默认1小时
    const cutoffTime = Date.now() - olderThanMs;
    
    // 清理旧任务
    for (const [taskId, task] of this.tasks) {
      if (task.completedAt && task.completedAt < cutoffTime) {
        this.tasks.delete(taskId);
        this.aggregatedResults.delete(taskId);
      }
    }
    
    // 清理Agent的旧性能历史
    for (const agent of this.agents.values()) {
      agent.performanceHistory = agent.performanceHistory.filter(
        record => record.timestamp > cutoffTime
      );
    }
  }
}

// 默认导出
export default ResultAggregator;