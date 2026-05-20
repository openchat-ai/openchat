/**
 * 决策引擎 - 主 AI 决策支持系统
 *
 * 功能：
 * - 分析聚合反馈
 * - 评估可选方案
 * - 做出决策
 * - 学习和优化
 */

import { persistentConfig } from './persistent-config.js';
import logger from './logger.js';

export class DecisionEngine {
  constructor() {
    this.decisionHistory = [];
    this.performanceMetrics = new Map();
    this.learningData = {
      agentEffectiveness: {},  // 各类型 Agent 的效果评分
      decisionPatterns: [],   // 决策模式
      surprisingFindings: []  // 意外发现
    };
  }

  /**
   * 分析聚合反馈
   */
  analyzeFeedback(aggregatedFeedback) {
    const { key_findings = [], consensus_level = 0 } = aggregatedFeedback;

    // 按严重程度分组
    const bySeverity = {
      CRITICAL: [],
      HIGH: [],
      MEDIUM: [],
      LOW: []
    };

    for (const finding of key_findings) {
      const severity = finding.severity || 'MEDIUM';
      if (bySeverity[severity]) {
        bySeverity[severity].push(finding);
      }
    }

    // 计算风险评估
    let riskAssessment = 'LOW';
    if (bySeverity.CRITICAL.length > 0) riskAssessment = 'CRITICAL';
    else if (bySeverity.HIGH.length > 0) riskAssessment = 'HIGH';
    else if (bySeverity.MEDIUM.length > 0) riskAssessment = 'MEDIUM';

    return {
      bySeverity,
      riskAssessment,
      consensusLevel: consensus_level,
      totalFindings: key_findings.length,
      criticalCount: bySeverity.CRITICAL.length,
      highCount: bySeverity.HIGH.length
    };
  }

  /**
   * 评估可选方案
   */
  evaluateOptions(analysis, context = {}) {
    const { riskAssessment, criticalCount, highCount } = analysis;
    const options = [];

    // 选项1：完全采纳
    if (criticalCount === 0 && highCount <= 1) {
      options.push({
        option: 'FULL_ADOPTION',
        pros: '采纳所有改进，解决识别的问题',
        cons: '可能存在未发现的风险',
        risk: 'MEDIUM',
        score: 80
      });
    }

    // 选项2：部分采纳
    if (criticalCount === 0 || (criticalCount > 0 && highCount > 0)) {
      options.push({
        option: 'PARTIAL_ADOPTION',
        pros: '采纳安全的改进，修复关键问题',
        cons: '需要额外工作',
        risk: 'MEDIUM',
        score: 85
      });
    }

    // 选项3：修复后采纳
    if (criticalCount > 0) {
      options.push({
        option: 'FIX_THEN_ADOPT',
        pros: '先修复所有关键问题，然后采纳改进',
        cons: '需要多轮迭代',
        risk: 'LOW',
        score: 90
      });
    }

    // 选项4：拒绝
    if (criticalCount === 0) {
      options.push({
        option: 'REJECT',
        pros: '避免任何风险',
        cons: '失去改进机会',
        risk: 'LOW',
        score: 30
      });
    }

    // 根据风险评估调整分数
    if (riskAssessment === 'CRITICAL') {
      options.forEach(opt => {
        if (opt.option !== 'REJECT') opt.score -= 20;
      });
    }

    // 排序返回最高分选项在前
    return options.sort((a, b) => b.score - a.score);
  }

  /**
   * 做出决策
   */
  async makeDecision(task, aggregatedFeedback, secondaryAgents) {
    const analysis = this.analyzeFeedback(aggregatedFeedback);
    const options = this.evaluateOptions(analysis, { task });

    // 选择最佳方案
    const bestOption = options[0];

    // 构建决策对象
    const decision = {
      decision_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      task,
      analysis,
      options,
      selectedOption: bestOption,
      reasoning: this.buildReasoning(analysis, bestOption, secondaryAgents),
      approved_changes: this.extractApprovedChanges(analysis, bestOption),
      required_fixes: this.extractRequiredFixes(analysis, bestOption),
      next_steps: this.generateNextSteps(bestOption, secondaryAgents)
    };

    // 记录决策历史
    this.decisionHistory.push(decision);

    // 持久化
    await this.persistDecision(decision);

    return decision;
  }

  /**
   * 构建决策理由
   */
  buildReasoning(analysis, option, secondaryAgents) {
    const { riskAssessment, criticalCount, highCount } = analysis;
    const agentTypes = secondaryAgents.map(a => a.type).join(', ');

    let reasoning = `基于${secondaryAgents.length}个次AI的分析（${agentTypes}），`;
    reasoning += `风险评估为${riskAssessment}，`;

    switch (option.option) {
      case 'FULL_ADOPTION':
        reasoning += `识别了${criticalCount}个严重问题和${highCount}个高优先级问题，`;
        reasoning += `但所有问题都在可接受范围内，建议完全采纳改进。`;
        break;
      case 'PARTIAL_ADOPTION':
        reasoning += `存在${criticalCount}个严重问题需要修复，高优先级问题${highCount}个，`;
        reasoning += `建议部分采纳并修复关键问题。`;
        break;
      case 'FIX_THEN_ADOPT':
        reasoning += `发现${criticalCount}个严重问题必须先修复，`;
        reasoning += `建议先处理安全问题再进行改进。`;
        break;
      case 'REJECT':
        reasoning += `风险过高，建议暂时拒绝，等待更多信息。`;
        break;
    }

    return reasoning;
  }

  /**
   * 提取批准的变更
   */
  extractApprovedChanges(analysis, option) {
    if (option.option === 'REJECT') return [];

    const changes = [];
    const { bySeverity } = analysis;

    // 批准所有非关键变更
    if (option.option === 'FULL_ADOPTION' || option.option === 'PARTIAL_ADOPTION') {
      [...bySeverity.MEDIUM, ...bySeverity.LOW].forEach(f => {
        changes.push({
          finding: f.feedback || f.description,
          approved: true
        });
      });
    }

    return changes;
  }

  /**
   * 提取必须的修复
   */
  extractRequiredFixes(analysis, option) {
    const fixes = [];
    const { bySeverity } = analysis;

    if (option.option === 'PARTIAL_ADOPTION' || option.option === 'FIX_THEN_ADOPT') {
      bySeverity.CRITICAL.forEach(f => {
        fixes.push({
          severity: 'CRITICAL',
          finding: f.feedback || f.description,
          location: f.location,
          remediation: f.remediation
        });
      });
    }

    if (option.option === 'FIX_THEN_ADOPT') {
      bySeverity.HIGH.forEach(f => {
        fixes.push({
          severity: 'HIGH',
          finding: f.feedback || f.description,
          location: f.location,
          remediation: f.remediation
        });
      });
    }

    return fixes;
  }

  /**
   * 生成后续步骤
   */
  generateNextSteps(option, secondaryAgents) {
    const steps = [];

    switch (option.option) {
      case 'FULL_ADOPTION':
        steps.push({ action: 'APPLY_CHANGES', description: '应用所有批准的变更' });
        steps.push({ action: 'VERIFY', description: '验证变更效果' });
        break;
      case 'PARTIAL_ADOPTION':
        steps.push({ action: 'FIX_CRITICAL', description: '修复严重问题' });
        steps.push({ action: 'APPLY_CHANGES', description: '应用剩余变更' });
        steps.push({ action: 'REVERIFY', description: '重新验证' });
        break;
      case 'FIX_THEN_ADOPT':
        // 找出需要创建哪些类型的 Agent 来修复
        const securityAgent = secondaryAgents.find(a => a.type === 'security_auditor');
        if (!securityAgent) {
          steps.push({ action: 'CREATE_AGENT', type: 'security_auditor', description: '创建安全审计 Agent' });
        }
        steps.push({ action: 'FIX_ISSUES', description: '修复所有识别的问题' });
        steps.push({ action: 'CREATE_AGENT', type: 'test_engineer', description: '创建测试工程师 Agent 生成测试' });
        steps.push({ action: 'RETRY', description: '重新执行分析' });
        break;
      case 'REJECT':
        steps.push({ action: 'GATHER_INFO', description: '收集更多信息' });
        steps.push({ action: 'RETRY_LATER', description: '稍后重新评估' });
        break;
    }

    return steps;
  }

  /**
   * 持久化决策
   */
  async persistDecision(decision) {
    try {
      const config = await persistentConfig.get('decisions') || [];
      config.push({
        decision_id: decision.decision_id,
        timestamp: decision.timestamp,
        task: decision.task,
        selectedOption: decision.selectedOption.option,
        reasoning: decision.reasoning
      });
      // 保留最近 100 个决策
      if (config.length > 100) {
        config.splice(0, config.length - 100);
      }
      await persistentConfig.set('decisions', config);
    } catch (e) {
      logger.error('Failed to persist decision:', e);
    }
  }

  /**
   * 记录次 AI 性能
   */
  async recordAgentPerformance(agentType, performance) {
    if (!this.learningData.agentEffectiveness[agentType]) {
      this.learningData.agentEffectiveness[agentType] = {
        totalDecisions: 0,
        effectivenessSum: 0,
        efficiencySum: 0,
        accuracySum: 0
      };
    }

    const data = this.learningData.agentEffectiveness[agentType];
    data.totalDecisions++;
    data.effectivenessSum += performance.effectiveness || 0;
    data.efficiencySum += performance.efficiency || 0;
    data.accuracySum += performance.accuracy || 0;

    // 持久化
    await persistentConfig.set('agent_performance', this.learningData.agentEffectiveness);
  }

  /**
   * 获取 Agent 性能统计
   */
  getAgentPerformanceStats(agentType) {
    const data = this.learningData.agentEffectiveness[agentType];
    if (!data || data.totalDecisions === 0) {
      return null;
    }

    return {
      agentType,
      totalDecisions: data.totalDecisions,
      avgEffectiveness: Math.round(data.effectivenessSum / data.totalDecisions),
      avgEfficiency: Math.round(data.efficiencySum / data.totalDecisions),
      avgAccuracy: Math.round(data.accuracySum / data.totalDecisions),
      trend: this.calculateTrend(agentType)
    };
  }

  /**
   * 计算趋势
   */
  calculateTrend(agentType) {
    const data = this.learningData.agentEffectiveness[agentType];
    if (!data || data.totalDecisions < 5) return 'stable';

    // 简单趋势计算：比较前50%和后50%的平均值
    const recent = data.effectivenessSum / data.totalDecisions;
    return recent > 85 ? 'improving' : recent < 70 ? 'declining' : 'stable';
  }

  /**
   * 获取决策历史
   */
  getDecisionHistory(limit = 10) {
    return this.decisionHistory.slice(-limit);
  }

  /**
   * 获取所有 Agent 性能统计
   */
  getAllAgentStats() {
    const stats = [];
    for (const type of Object.keys(this.learningData.agentEffectiveness)) {
      stats.push(this.getAgentPerformanceStats(type));
    }
    return stats.filter(s => s !== null);
  }

  /**
   * 加载历史数据
   */
  async loadHistory() {
    try {
      const decisions = await persistentConfig.get('decisions');
      if (decisions) {
        this.decisionHistory = decisions;
      }

      const performance = await persistentConfig.get('agent_performance');
      if (performance) {
        this.learningData.agentEffectiveness = performance;
      }
    } catch (e) {
      logger.error('Failed to load decision history:', e);
    }
  }
}

// 单例
export const decisionEngine = new DecisionEngine();