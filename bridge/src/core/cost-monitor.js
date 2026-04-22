import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COST_LOG_PATH = path.join(__dirname, '../../logs/cost-monitor.json');

/**
 * 成本监控器 - 跟踪模型使用情况和成本
 */
export class CostMonitor {
  constructor() {
    this.stats = {
      totalTasks: 0,
      totalCost: 0,
      modelUsage: {
        haiku: { count: 0, cost: 0 },
        sonnet: { count: 0, cost: 0 },
        opus: { count: 0, cost: 0 }
      },
      qualityMetrics: {
        haiku: { success: 0, failure: 0 },
        sonnet: { success: 0, failure: 0 },
        opus: { success: 0, failure: 0 }
      },
      timestamp: Date.now()
    };

    this.prices = {
      haiku: 0.002,    // 0.002元/次
      sonnet: 0.03,    // 0.03元/次
      opus: 0.3        // 0.3元/次
    };

    this.loadStats();
  }

  loadStats() {
    try {
      if (fs.existsSync(COST_LOG_PATH)) {
        const data = fs.readFileSync(COST_LOG_PATH, 'utf8');
        const saved = JSON.parse(data);
        this.stats = { ...this.stats, ...saved };
      }
    } catch (e) {
      console.error('[CostMonitor] Failed to load stats:', e.message);
    }
  }

  saveStats() {
    try {
      // 确保日志目录存在
      const logDir = path.dirname(COST_LOG_PATH);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // 更新时间戳
      this.stats.timestamp = Date.now();

      // 保存数据
      fs.writeFileSync(COST_LOG_PATH, JSON.stringify(this.stats, null, 2), 'utf8');
    } catch (e) {
      console.error('[CostMonitor] Failed to save stats:', e.message);
    }
  }

  /**
   * 记录模型使用
   * @param {string} modelType - haiku/sonnet/opus
   * @param {boolean} success - 任务是否成功
   */
  recordUsage(modelType, success = true) {
    if (!this.prices[modelType]) {
      console.warn(`[CostMonitor] Unknown model type: ${modelType}`);
      return;
    }

    // 更新使用统计
    this.stats.totalTasks++;
    const cost = this.prices[modelType];
    this.stats.totalCost += cost;

    // 更新模型特定统计
    if (!this.stats.modelUsage[modelType]) {
      this.stats.modelUsage[modelType] = { count: 0, cost: 0 };
    }
    this.stats.modelUsage[modelType].count++;
    this.stats.modelUsage[modelType].cost += cost;

    // 更新质量指标
    if (!this.stats.qualityMetrics[modelType]) {
      this.stats.qualityMetrics[modelType] = { success: 0, failure: 0 };
    }
    if (success) {
      this.stats.qualityMetrics[modelType].success++;
    } else {
      this.stats.qualityMetrics[modelType].failure++;
    }

    this.saveStats();
  }

  /**
   * 获取成本报告
   */
  getCostReport() {
    const totalCost = this.stats.totalCost;
    const totalTasks = this.stats.totalTasks;
    const avgCostPerTask = totalTasks > 0 ? totalCost / totalTasks : 0;

    // 计算实际分布百分比
    let actualHaikuPercent = 0;
    let actualSonnetPercent = 0;
    let actualOpusPercent = 0;

    if (totalTasks > 0) {
      const haikuCount = this.stats.modelUsage.haiku?.count || 0;
      const sonnetCount = this.stats.modelUsage.sonnet?.count || 0;
      const opusCount = this.stats.modelUsage.opus?.count || 0;

      actualHaikuPercent = (haikuCount / totalTasks) * 100;
      actualSonnetPercent = (sonnetCount / totalTasks) * 100;
      actualOpusPercent = (opusCount / totalTasks) * 100;
    }

    // 计算成功率和失败率
    const haikuSuccessRate = this.calculateSuccessRate('haiku');
    const sonnetSuccessRate = this.calculateSuccessRate('sonnet');
    const opusSuccessRate = this.calculateSuccessRate('opus');

    return {
      summary: {
        totalTasks,
        totalCost: totalCost.toFixed(4) + '元',
        avgCostPerTask: avgCostPerTask.toFixed(5) + '元'
      },
      distribution: {
        haiku: `${actualHaikuPercent.toFixed(1)}%`,
        sonnet: `${actualSonnetPercent.toFixed(1)}%`,
        opus: `${actualOpusPercent.toFixed(1)}%`
      },
      quality: {
        haiku: `${haikuSuccessRate.toFixed(1)}%`,
        sonnet: `${sonnetSuccessRate.toFixed(1)}%`,
        opus: `${opusSuccessRate.toFixed(1)}%`
      },
      recommendations: this.getRecommendations()
    };
  }

  /**
   * 计算成功率
   */
  calculateSuccessRate(modelType) {
    const metrics = this.stats.qualityMetrics[modelType];
    if (!metrics) return 0;

    const total = metrics.success + metrics.failure;
    if (total === 0) return 0;

    return (metrics.success / total) * 100;
  }

  /**
   * 获取优化建议
   */
  getRecommendations() {
    const recommendations = [];
    const report = this.getCostReport();

    // 解析分布百分比
    const haikuPercent = parseFloat(report.distribution.haiku);
    const sonnetPercent = parseFloat(report.distribution.sonnet);
    const sonnetSuccessRate = parseFloat(report.quality.sonnet);
    const haikuSuccessRate = parseFloat(report.quality.haiku);

    // 建议1: 如果haiku成功率高且使用率低，增加haiku比例

    if (haikuSuccessRate > 85 && haikuPercent < 50) {
      recommendations.push({
        type: 'INCREASE_HAIKU_USAGE',
        reason: `haiku成功率${haikuSuccessRate.toFixed(1)}%较高，当前使用率${haikuPercent.toFixed(1)}%偏低，可提高haiku使用比例到50-60%以降低总成本`,
        action: '增加haiku使用阈值，将更多简单任务分配给haiku'
      });
    }

    // 建议2: 如果sonnet成功率低且使用率高，减少sonnet比例

    if (sonnetSuccessRate < 90 && sonnetPercent > 60) {
      recommendations.push({
        type: 'DECREASE_SONNET_USAGE',
        reason: `sonnet成功率${sonnetSuccessRate.toFixed(1)}%偏低，当前使用率${sonnetPercent.toFixed(1)}%偏高，可减少sonnet使用比例到40-50%`,
        action: '降低sonnet使用阈值，将部分中等任务重新评估能否由haiku处理'
      });
    }

    // 建议3: 如果opus使用率高于目标，考虑进一步限制使用

    const opusPercent = parseFloat(report.distribution.opus);
    if (opusPercent > 5) {
      recommendations.push({
        type: 'LIMIT_OPUS_USAGE',
        reason: `opus使用率${opusPercent.toFixed(1)}%超过目标5%，考虑提高复杂度阈值`,
        action: '提高任务复杂度要求，只有真正复杂的任务才使用opus'
      });
    }

    // 如果总成本较高，建议调整策略

    const totalCost = parseFloat(report.summary.totalCost);
    if (totalCost > 50) {
      recommendations.push({
        type: 'COST_ALERT',
        reason: `总成本已超过50元，建议开启更严格成本控制`,
        action: '启用每日成本限制，设置成本预警机制'
      });
    }

    return recommendations;
  }

  /**
   * 重置统计
   */
  reset() {
    this.stats = {
      totalTasks: 0,
      totalCost: 0,
      modelUsage: {
        haiku: { count: 0, cost: 0 },
        sonnet: { count: 0, cost: 0 },
        opus: { count: 0, cost: 0 }
      },
      qualityMetrics: {
        haiku: { success: 0, failure: 0 },
        sonnet: { success: 0, failure: 0 },
        opus: { success: 0, failure: 0 }
      },
      timestamp: Date.now()
    };
    this.saveStats();
  }
}

// 单例实例
export const costMonitor = new CostMonitor();

/**
 * 成本监控中间件 - 用于包装AgentEngine调用
 */
export function withCostMonitoring(executeTask) {
  return async function monitoredExecute(task, options = {}) {
    const startTime = Date.now();
    let success = false;
    let result;

    try {
      result = await executeTask(task, options);
      success = true;
      return result;
    } finally {
      const modelType = options.modelType || 'sonnet'; // 默认
      costMonitor.recordUsage(modelType, success);
    }
  };
}