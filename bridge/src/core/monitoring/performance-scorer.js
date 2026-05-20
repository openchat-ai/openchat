/**
 * 性能评分和学习系统
 *
 * 功能：
 * - 记录协作效果
 * - 更新代理评分
 * - 学习改进
 */

import { persistentConfig } from '../persistent-config.js';
import logger from '../monitoring/logger.js';

export class PerformanceScorer {
  constructor() {
    this.agentScores = new Map();         // Agent 评分
    this.learningHistory = [];           // 学习历史
    this.decisionOutcomeHistory = [];    // 决策结果历史
  }

  /**
   * 评估 Agent 性能
   */
  evaluateAgent(agent, feedback, executionMetrics = {}) {
    const scores = {
      effectiveness: this.calculateEffectiveness(feedback),
      efficiency: this.calculateEfficiency(executionMetrics),
      timeliness: this.calculateTimeliness(executionMetrics),
      accuracy: this.calculateAccuracy(feedback)
    };

    // 综合评分（加权平均）
    const overall = Math.round(
      scores.effectiveness * 0.35 +
      scores.efficiency * 0.25 +
      scores.timeliness * 0.20 +
      scores.accuracy * 0.20
    );

    return {
      agent_id: agent.agent_id,
      agent_type: agent.type,
      scores,
      overall,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 计算有效性评分
   */
  calculateEffectiveness(feedback) {
    if (!feedback || !feedback.findings) return 50;

    const { findings = [] } = feedback;
    let score = 100;

    // 根据发现的问题扣分
    const criticalCount = findings.filter(f => f.type === 'CRITICAL').length;
    const highCount = findings.filter(f => f.type === 'HIGH').length;

    score -= criticalCount * 15;
    score -= highCount * 8;

    // 成功标准达成情况
    if (feedback.success_criteria_met) {
      const metCount = feedback.success_criteria_met.filter(c => c.includes('✅')).length;
      const totalCount = feedback.success_criteria_met.length;
      score = Math.round(score * (metCount / totalCount));
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 计算效率评分
   */
  calculateEfficiency(metrics) {
    if (!metrics || Object.keys(metrics).length === 0) return 75;

    const { cpu_usage_percent = 0, memory_usage_mb = 0 } = metrics;
    let score = 100;

    // CPU 使用评分
    if (cpu_usage_percent > 90) score -= 30;
    else if (cpu_usage_percent > 80) score -= 20;
    else if (cpu_usage_percent > 70) score -= 10;

    // 内存使用评分
    if (memory_usage_mb > 1024) score -= 20;
    else if (memory_usage_mb > 512) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 计算时效性评分
   */
  calculateTimeliness(metrics) {
    if (!metrics || !metrics.total_time_ms) return 75;

    const { total_time_ms, max_time_minutes = 30 } = metrics;
    const maxTimeMs = max_time_minutes * 60 * 1000;

    const ratio = total_time_ms / maxTimeMs;
    if (ratio <= 0.5) return 100;
    if (ratio <= 0.75) return 90;
    if (ratio <= 1.0) return 75;
    if (ratio <= 1.25) return 50;
    return 25;
  }

  /**
   * 计算准确度评分
   */
  calculateAccuracy(feedback) {
    if (!feedback || !feedback.findings) return 75;

    const { findings = [], confidence } = feedback;

    // 基于置信度评分
    let score = confidence || 75;

    // 如果有高置信度的正面验证，增加分数
    const validatedCount = findings.filter(f => f.validated === true).length;
    if (findings.length > 0) {
      score += Math.round((validatedCount / findings.length) * 10);
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 更新 Agent 评分
   */
  async updateAgentScore(agentType, newScore) {
    if (!this.agentScores.has(agentType)) {
      this.agentScores.set(agentType, {
        type: agentType,
        scores: [],
        average: 0,
        totalEvaluations: 0,
        lastUpdated: null
      });
    }

    const scoreData = this.agentScores.get(agentType);
    scoreData.scores.push(newScore.overall);
    scoreData.totalEvaluations++;
    scoreData.average = Math.round(
      scoreData.scores.reduce((a, b) => a + b, 0) / scoreData.scores.length
    );
    scoreData.lastUpdated = new Date().toISOString();

    // 保留最近 100 条评分
    if (scoreData.scores.length > 100) {
      scoreData.scores.shift();
    }

    // 持久化
    await this.persistScores();

    return scoreData;
  }

  /**
   * 获取 Agent 评分
   */
  getAgentScore(agentType) {
    return this.agentScores.get(agentType);
  }

  /**
   * 获取所有 Agent 评分
   */
  getAllScores() {
    return Array.from(this.agentScores.entries()).map(([type, data]) => ({
      type,
      ...data
    }));
  }

  /**
   * 记录学习数据
   */
  async recordLearning(decision, outcome) {
    const learning = {
      decision_id: decision.decision_id,
      timestamp: new Date().toISOString(),
      decision_type: decision.selectedOption?.option,
      outcome,
      agent_effectiveness: outcome.agentEffectiveness || {},
      surprising_findings: outcome.surprisingFindings || [],
      improvements: outcome.improvements || []
    };

    this.learningHistory.push(learning);
    this.decisionOutcomeHistory.push({ decision_id: decision.decision_id, outcome });

    // 持久化
    await this.persistLearning();

    return learning;
  }

  /**
   * 分析决策效果
   */
  analyzeDecisionOutcome(decisionId) {
    const decision = this.decisionOutcomeHistory.find(d => d.decision_id === decisionId);
    if (!decision) return null;

    // 简单分析：检查是否有后续相关决策
    const relatedDecisions = this.decisionOutcomeHistory.filter(
      d => d.decision_id !== decisionId && d.outcome === 'SUCCESS'
    );

    return {
      decision_id: decisionId,
      outcome: decision.outcome,
      related_success_count: relatedDecisions.length,
      trend: this.calculateOutcomeTrend()
    };
  }

  /**
   * 计算结果趋势
   */
  calculateOutcomeTrend() {
    if (this.learningHistory.length < 5) return 'insufficient_data';

    const recent = this.learningHistory.slice(-10);
    const successCount = recent.filter(l => l.outcome === 'SUCCESS').length;
    const ratio = successCount / recent.length;

    if (ratio >= 0.8) return 'improving';
    if (ratio >= 0.6) return 'stable';
    if (ratio >= 0.4) return 'declining';
    return 'needs_attention';
  }

  /**
   * 生成改进建议
   */
  generateImprovements() {
    const suggestions = [];

    // 分析各类型 Agent 的表现
    for (const [type, data] of this.agentScores) {
      if (data.totalEvaluations < 3) continue;

      if (data.average < 70) {
        suggestions.push({
          type: 'AGENT_WEIGHT',
          agent_type: type,
          suggestion: `降低 ${type} 的权重，当前评分 ${data.average}`,
          priority: 'HIGH'
        });
      } else if (data.average >= 90) {
        suggestions.push({
          type: 'AGENT_WEIGHT',
          agent_type: type,
          suggestion: `增加 ${type} 的权重，当前评分 ${data.average}`,
          priority: 'LOW'
        });
      }
    }

    // 检查趋势
    const trend = this.calculateOutcomeTrend();
    if (trend === 'declining') {
      suggestions.push({
        type: 'OVERALL_STRATEGY',
        suggestion: '决策成功率下降，建议重新评估策略',
        priority: 'HIGH'
      });
    }

    return suggestions;
  }

  /**
   * 持久化评分
   */
  async persistScores() {
    try {
      const scoresObj = Object.fromEntries(this.agentScores);
      await persistentConfig.set('agent_scores', scoresObj);
    } catch (e) {
      logger.error('Failed to persist agent scores:', e);
    }
  }

  /**
   * 持久化学习历史
   */
  async persistLearning() {
    try {
      // 保留最近 100 条
      const toSave = this.learningHistory.slice(-100);
      await persistentConfig.set('learning_history', toSave);
    } catch (e) {
      logger.error('Failed to persist learning history:', e);
    }
  }

  /**
   * 加载历史数据
   */
  async loadHistory() {
    try {
      const scores = await persistentConfig.get('agent_scores');
      if (scores) {
        this.agentScores = new Map(Object.entries(scores));
      }

      const learning = await persistentConfig.get('learning_history');
      if (learning) {
        this.learningHistory = learning;
      }
    } catch (e) {
      logger.error('Failed to load history:', e);
    }
  }
}

// 单例
export const performanceScorer = new PerformanceScorer();