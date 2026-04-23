/**
 * Feedback Aggregator
 * 反馈聚合 - 规范化、去重、优先级排序、冲突解决
 */

class FeedbackAggregator {
  constructor(options = {}) {
    this.normalizeEnabled = options.normalize !== false;
    this.deduplicateEnabled = options.deduplicate !== false;
    this.prioritizeEnabled = options.prioritize !== false;
  }

  /**
   * 聚合来自多个 Agent 的反馈
   */
  aggregate(feedbackList, options = {}) {
    if (!Array.isArray(feedbackList) || feedbackList.length === 0) {
      return {
        aggregated: false,
        feedback: [],
        summary: { total: 0 }
      };
    }

    let processed = [...feedbackList];

    // 1. 规范化
    if (options.normalize !== false && this.normalizeEnabled) {
      processed = processed.map(fb => this.normalize(fb));
    }

    // 2. 去重
    if (options.deduplicate !== false && this.deduplicateEnabled) {
      processed = this.deduplicate(processed);
    }

    // 3. 优先级排序
    if (options.prioritize !== false && this.prioritizeEnabled) {
      processed = this.prioritize(processed);
    }

    // 4. 冲突解决
    if (options.resolveConflicts !== false) {
      processed = this.resolveConflicts(processed);
    }

    // 5. 生成摘要
    const summary = this.generateSummary(processed);

    return {
      aggregated: true,
      feedback: processed,
      summary
    };
  }

  /**
   * 规范化反馈（按角色类型）
   */
  normalize(feedback) {
    const normalized = { ...feedback };

    // 添加标准字段
    normalized.category = feedback.category || feedback.agentRole || 'custom';
    normalized.priority = feedback.priority || this.getDefaultPriority(feedback);
    normalized.timestamp = feedback.timestamp || new Date().toISOString();

    // 按角色类型规范化内容
    switch (feedback.agentRole) {
      case 'security_auditor':
        normalized.severity = feedback.severity || 'MEDIUM';
        normalized.vulnerabilities = feedback.vulnerabilities || [];
        normalized.risks = feedback.risks || [];
        normalized.recommendations = feedback.recommendations || [];
        break;

      case 'code_quality_analyzer':
        normalized.issues = feedback.issues || [];
        normalized.score = feedback.score || 0;
        normalized.complexity = feedback.complexity || {};
        break;

      case 'performance_analyzer':
        normalized.metrics = feedback.metrics || {};
        normalized.bottlenecks = feedback.bottlenecks || [];
        normalized.optimizationPotential = feedback.optimizationPotential || 0;
        break;

      case 'test_engineer':
        normalized.testCases = feedback.testCases || 0;
        normalized.passed = feedback.passed || 0;
        normalized.failed = feedback.failed || 0;
        normalized.coverage = feedback.coverage || 0;
        break;

      default:
        // custom 类型保持原样
        break;
    }

    return normalized;
  }

  /**
   * 获取默认优先级
   */
  getDefaultPriority(feedback) {
    // 根据内容自动确定优先级
    if (feedback.severity === 'CRITICAL') return 'CRITICAL';
    if (feedback.severity === 'HIGH') return 'HIGH';
    if (feedback.type === 'security_analysis') return 'HIGH';
    if (feedback.type === 'performance_analysis') return 'NORMAL';
    if (feedback.type === 'test_engineering') return 'LOW';

    return 'MEDIUM';
  }

  /**
   * 去重（基于内容相似度）
   */
  deduplicate(feedbackList) {
    const unique = [];
    const seen = new Map(); // hash -> index

    for (const fb of feedbackList) {
      // 简单的哈希：基于类型、优先级和摘要
      const hash = this.hashFeedback(fb);

      if (!seen.has(hash)) {
        seen.set(hash, unique.length);
        unique.push(fb);
      } else {
        // 合并相似反馈
        const existingIndex = seen.get(hash);
        unique[existingIndex] = this.mergeSimilar(unique[existingIndex], fb);
      }
    }

    return unique;
  }

  /**
   * 计算反馈哈希
   */
  hashFeedback(feedback) {
    const key = `${feedback.type || 'unknown'}-${feedback.priority || 'MEDIUM'}-${feedback.category || 'custom'}`;
    return key;
  }

  /**
   * 合并相似反馈
   */
  mergeSimilar(existing, incoming) {
    const merged = { ...existing };

    // 合并数组字段
    if (existing.vulnerabilities && incoming.vulnerabilities) {
      merged.vulnerabilities = [...existing.vulnerabilities, ...incoming.vulnerabilities];
    }
    if (existing.issues && incoming.issues) {
      merged.issues = [...existing.issues, ...incoming.issues];
    }
    if (existing.recommendations && incoming.recommendations) {
      // 去重推荐
      const all = [...existing.recommendations, ...incoming.recommendations];
      merged.recommendations = [...new Set(all)];
    }

    // 更新摘要
    merged._mergedCount = (existing._mergedCount || 1) + 1;

    return merged;
  }

  /**
   * 优先级排序
   */
  prioritize(feedbackList) {
    const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

    return feedbackList.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 2;
      const pb = priorityOrder[b.priority] ?? 2;

      if (pa !== pb) return pa - pb;

      // 同优先级按时间排序
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
  }

  /**
   * 冲突解决
   */
  resolveConflicts(feedbackList) {
    const resolved = [];
    const conflicts = new Map();

    for (const fb of feedbackList) {
      const key = this.getConflictKey(fb);

      if (!conflicts.has(key)) {
        conflicts.set(key, fb);
      } else {
        // 处理冲突：优先保留优先级高的
        const existing = conflicts.get(key);
        if (this.comparePriority(fb, existing) > 0) {
          conflicts.set(key, fb);
        }
      }
    }

    return Array.from(conflicts.values());
  }

  /**
   * 获取冲突键
   */
  getConflictKey(feedback) {
    // 相同类型的反馈可能冲突
    return `${feedback.category || 'unknown'}-${feedback.type || 'unknown'}`;
  }

  /**
   * 比较优先级
   */
  comparePriority(a, b) {
    const priorityOrder = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 };
    const pa = priorityOrder[a.priority] ?? 1;
    const pb = priorityOrder[b.priority] ?? 1;
    return pa - pb;
  }

  /**
   * 生成摘要
   */
  generateSummary(feedbackList) {
    const summary = {
      total: feedbackList.length,
      byPriority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      byCategory: {},
      byType: {}
    };

    for (const fb of feedbackList) {
      // 按优先级统计
      const priority = fb.priority || 'MEDIUM';
      if (summary.byPriority[priority] !== undefined) {
        summary.byPriority[priority]++;
      }

      // 按类别统计
      const category = fb.category || 'custom';
      summary.byCategory[category] = (summary.byCategory[category] || 0) + 1;

      // 按类型统计
      const type = fb.type || 'unknown';
      summary.byType[type] = (summary.byType[type] || 0) + 1;
    }

    return summary;
  }
}

module.exports = FeedbackAggregator;