import logger from '../monitoring/logger.js';
/**
 * 经验积累器
 * 记录任务执行结果，识别成功/失败模式
 */

export class ExperienceAccumulator {
  constructor(options = {}) {
    this.experiences = new Map();
    this.patterns = new Map();
    this.knowledgeBase = new Map();
    
    this.maxExperiences = options.maxExperiences || 1000; // 最大经验数量
    this.patternThreshold = options.patternThreshold || 3; // 模式识别阈值
    this.learningRate = options.learningRate || 0.1; // 学习速率
    this.forgettingFactor = options.forgettingFactor || 0.99; // 遗忘因子
    
    // 经验分类
    this.successfulExperiences = [];
    this.failedExperiences = [];
    
    // 模式类型
    this.patternTypes = {
      SUCCESS: 'success',
      FAILURE: 'failure',
      IMPROVEMENT: 'improvement',
      OPTIMIZATION: 'optimization'
    };
  }

  /**
   * 记录经验
   */
  recordExperience(taskId, experienceData) {
    const experience = {
      id: taskId,
      timestamp: Date.now(),
      task: experienceData.task || '',
      input: experienceData.input || {},
      output: experienceData.output || {},
      success: experienceData.success !== false,
      duration: experienceData.duration || 0,
      resources: experienceData.resources || {},
      context: experienceData.context || {},
      feedback: experienceData.feedback || {},
      metadata: {
        version: experienceData.version || '1.0',
        source: experienceData.source || 'system',
        tags: experienceData.tags || []
      }
    };
    
    // 存储经验
    this.experiences.set(taskId, experience);
    
    // 分类存储
    if (experience.success) {
      this.successfulExperiences.push(experience);
    } else {
      this.failedExperiences.push(experience);
    }
    
    // 限制经验数量
    this._limitExperienceCount();
    
    // 检查模式
    this._analyzeExperiencePatterns(experience);
    
    logger.info(`[ExperienceAccumulator] Recorded experience: ${taskId} - Success: ${experience.success}`);
    
    return experience.id;
  }

  /**
   * 限制经验数量
   */
  _limitExperienceCount() {
    if (this.experiences.size > this.maxExperiences) {
      // 移除最早的经验
      const oldestId = this._getOldestExperienceId();
      if (oldestId) {
        const exp = this.experiences.get(oldestId);
        if (exp.success) {
          const index = this.successfulExperiences.findIndex(e => e.id === oldestId);
          if (index !== -1) this.successfulExperiences.splice(index, 1);
        } else {
          const index = this.failedExperiences.findIndex(e => e.id === oldestId);
          if (index !== -1) this.failedExperiences.splice(index, 1);
        }
        this.experiences.delete(oldestId);
      }
    }
  }

  /**
   * 获取最旧的经验ID
   */
  _getOldestExperienceId() {
    let oldestTime = Infinity;
    let oldestId = null;
    
    for (const [id, exp] of this.experiences) {
      if (exp.timestamp < oldestTime) {
        oldestTime = exp.timestamp;
        oldestId = id;
      }
    }
    
    return oldestId;
  }

  /**
   * 分析经验模式
   */
  _analyzeExperiencePatterns(experience) {
    // 检查是否形成了新的模式
    this._detectSuccessPatterns(experience);
    this._detectFailurePatterns(experience);
    this._detectImprovementPatterns(experience);
  }

  /**
   * 检测成功模式
   */
  _detectSuccessPatterns(experience) {
    if (!experience.success) return;
    
    // 基于任务类型和输入特征检测模式
    const taskKey = this._extractTaskSignature(experience);
    const patternKey = `success_${taskKey}`;
    
    if (!this.patterns.has(patternKey)) {
      this.patterns.set(patternKey, {
        type: this.patternTypes.SUCCESS,
        signature: taskKey,
        occurrences: 0,
        successCount: 0,
        failureCount: 0,
        avgDuration: 0,
        totalDuration: 0,
        recommendations: [],
        lastUpdated: Date.now()
      });
    }
    
    const pattern = this.patterns.get(patternKey);
    pattern.occurrences++;
    pattern.successCount++;
    pattern.totalDuration += experience.duration;
    pattern.avgDuration = pattern.totalDuration / pattern.successCount;
    pattern.lastUpdated = Date.now();
    
    // 如果模式出现次数超过阈值，视为有效模式
    if (pattern.occurrences >= this.patternThreshold) {
      this._updateKnowledgeBase(patternKey, pattern);
    }
  }

  /**
   * 检测失败模式
   */
  _detectFailurePatterns(experience) {
    if (experience.success) return;
    
    const taskKey = this._extractTaskSignature(experience);
    const patternKey = `failure_${taskKey}`;
    
    if (!this.patterns.has(patternKey)) {
      this.patterns.set(patternKey, {
        type: this.patternTypes.FAILURE,
        signature: taskKey,
        occurrences: 0,
        successCount: 0,
        failureCount: 0,
        avgDuration: 0,
        totalDuration: 0,
        errorPatterns: [],
        recommendations: [],
        lastUpdated: Date.now()
      });
    }
    
    const pattern = this.patterns.get(patternKey);
    pattern.occurrences++;
    pattern.failureCount++;
    pattern.totalDuration += experience.duration;
    pattern.avgDuration = pattern.totalDuration / pattern.occurrences;
    
    // 提取错误模式
    if (experience.output.error) {
      const errorSignature = this._extractErrorSignature(experience.output.error);
      if (!pattern.errorPatterns.includes(errorSignature)) {
        pattern.errorPatterns.push(errorSignature);
      }
    }
    
    pattern.lastUpdated = Date.now();
    
    // 如果模式出现次数超过阈值，视为有效模式
    if (pattern.occurrences >= this.patternThreshold) {
      this._updateKnowledgeBase(patternKey, pattern);
    }
  }

  /**
   * 检测改进模式
   */
  _detectImprovementPatterns(experience) {
    // 检测性能改进或其他改进模式
    const taskKey = this._extractTaskSignature(experience);
    const patternKey = `improvement_${taskKey}`;
    
    // 查找相同任务的历史执行
    const historicalExperiences = this._getHistoricalExperiences(taskKey, 5);
    if (historicalExperiences.length >= 2) {
      const recent = historicalExperiences[historicalExperiences.length - 1];
      const previous = historicalExperiences[historicalExperiences.length - 2];
      
      // 检查是否有所改进（执行时间减少、成功率提高等）
      if (recent.duration < previous.duration * 0.8) { // 至少20%改进
        if (!this.patterns.has(patternKey)) {
          this.patterns.set(patternKey, {
            type: this.patternTypes.IMPROVEMENT,
            signature: taskKey,
            improvements: [],
            avgImprovement: 0,
            improvementCount: 0,
            lastUpdated: Date.now()
          });
        }
        
        const improvement = {
          from: previous.duration,
          to: recent.duration,
          improvement: ((previous.duration - recent.duration) / previous.duration) * 100,
          timestamp: Date.now()
        };
        
        const pattern = this.patterns.get(patternKey);
        pattern.improvements.push(improvement);
        pattern.improvementCount++;
        pattern.avgImprovement = pattern.improvements.reduce((sum, imp) => sum + imp.improvement, 0) / pattern.improvements.length;
        pattern.lastUpdated = Date.now();
        
        this._updateKnowledgeBase(patternKey, pattern);
      }
    }
  }

  /**
   * 获取历史经验
   */
  _getHistoricalExperiences(taskSignature, limit = 10) {
    const filtered = [];
    
    for (const exp of this.experiences.values()) {
      const signature = this._extractTaskSignature(exp);
      if (signature === taskSignature) {
        filtered.push(exp);
      }
    }
    
    // 按时间排序
    return filtered.sort((a, b) => a.timestamp - b.timestamp).slice(0, limit);
  }

  /**
   * 提取任务签名
   */
  _extractTaskSignature(experience) {
    // 基于任务名称、输入参数类型等创建签名
    const taskType = experience.task || 'unknown';
    const inputTypes = Object.keys(experience.input).sort().join('_');
    const contextKeys = Object.keys(experience.context).sort().join('_');
    
    return `${taskType}_${inputTypes}_${contextKeys}`.toLowerCase();
  }

  /**
   * 提取错误签名
   */
  _extractErrorSignature(error) {
    if (typeof error === 'string') {
      return error.substring(0, 50).toLowerCase(); // 取前50个字符
    } else if (error && typeof error === 'object') {
      return `${error.name || 'unknown'}_${error.code || 'unknown'}`.toLowerCase();
    }
    return 'unknown_error';
  }

  /**
   * 更新知识库
   */
  _updateKnowledgeBase(patternKey, pattern) {
    const knowledge = {
      id: patternKey,
      pattern,
      extractedAt: Date.now(),
      confidence: this._calculateConfidence(pattern),
      recommendations: this._generateRecommendations(pattern),
      applicableTo: this._inferApplicableTasks(pattern)
    };
    
    this.knowledgeBase.set(patternKey, knowledge);
    
    logger.info(`[ExperienceAccumulator] Identified pattern: ${patternKey} - Occurrences: ${pattern.occurrences}`);
  }

  /**
   * 计算置信度
   */
  _calculateConfidence(pattern) {
    // 基于发生次数和成功比例计算置信度
    if (pattern.type === this.patternTypes.SUCCESS) {
      return Math.min(1.0, pattern.successCount / pattern.occurrences);
    } else if (pattern.type === this.patternTypes.FAILURE) {
      return Math.min(1.0, pattern.failureCount / pattern.occurrences);
    }
    return Math.min(1.0, pattern.occurrences / this.patternThreshold);
  }

  /**
   * 生成建议
   */
  _generateRecommendations(pattern) {
    const recommendations = [];
    
    switch (pattern.type) {
      case this.patternTypes.SUCCESS:
        recommendations.push({
          type: 'best_practice',
          description: `This task pattern succeeds with ${Math.round(pattern.successCount/pattern.occurrences*100)}% success rate`,
          avgDuration: pattern.avgDuration,
          tips: ['Follow similar approach', 'Use same parameters']
        });
        break;
        
      case this.patternTypes.FAILURE:
        recommendations.push({
          type: 'avoidance',
          description: `This task pattern fails with ${Math.round(pattern.failureCount/pattern.occurrences*100)}% failure rate`,
          commonErrors: pattern.errorPatterns,
          suggestions: ['Try different approach', 'Modify parameters', 'Add error handling']
        });
        break;
        
      case this.patternTypes.IMPROVEMENT:
        recommendations.push({
          type: 'optimization',
          description: `Performance improved by ${pattern.avgImprovement.toFixed(2)}% on average`,
          techniques: ['Apply similar optimizations', 'Monitor performance metrics']
        });
        break;
    }
    
    return recommendations;
  }

  /**
   * 推断适用任务
   */
  _inferApplicableTasks(pattern) {
    // 基于签名模式推断适用的任务类型
    return [pattern.signature.split('_')[0]]; // 取任务类型部分
  }

  /**
   * 获取经验
   */
  getExperience(taskId) {
    return this.experiences.get(taskId);
  }

  /**
   * 获取模式
   */
  getPattern(patternKey) {
    return this.patterns.get(patternKey);
  }

  /**
   * 获取知识
   */
  getKnowledge(knowledgeId) {
    return this.knowledgeBase.get(knowledgeId);
  }

  /**
   * 搜索相关经验
   */
  searchExperiences(criteria) {
    const results = [];
    
    for (const [id, experience] of this.experiences) {
      if (this._matchesCriteria(experience, criteria)) {
        results.push(experience);
      }
    }
    
    // 按时间倒序排列
    return results.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * 检查是否匹配条件
   */
  _matchesCriteria(experience, criteria) {
    if (criteria.success !== undefined && experience.success !== criteria.success) {
      return false;
    }
    
    if (criteria.task && !experience.task.toLowerCase().includes(criteria.task.toLowerCase())) {
      return false;
    }
    
    if (criteria.durationThreshold && experience.duration > criteria.durationThreshold) {
      return false;
    }
    
    if (criteria.tags && criteria.tags.length > 0) {
      for (const tag of criteria.tags) {
        if (!experience.metadata.tags.includes(tag)) {
          return false;
        }
      }
    }
    
    return true;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalExperiences: this.experiences.size,
      successfulExperiences: this.successfulExperiences.length,
      failedExperiences: this.failedExperiences.length,
      totalPatterns: this.patterns.size,
      knowledgeEntries: this.knowledgeBase.size,
      successRate: this.experiences.size > 0 
        ? (this.successfulExperiences.length / this.experiences.size * 100).toFixed(2) + '%' 
        : '0%',
      maxExperiences: this.maxExperiences,
      patternThreshold: this.patternThreshold
    };
  }

  /**
   * 获取最佳实践
   */
  getBestPractices(taskType = null) {
    const bestPractices = [];
    
    for (const [key, knowledge] of this.knowledgeBase) {
      if (knowledge.pattern.type === this.patternTypes.SUCCESS) {
        if (!taskType || knowledge.pattern.signature.startsWith(taskType)) {
          bestPractices.push({
            taskPattern: knowledge.pattern.signature,
            successRate: (knowledge.pattern.successCount / knowledge.pattern.occurrences * 100).toFixed(2),
            avgDuration: knowledge.pattern.avgDuration,
            recommendations: knowledge.recommendations
          });
        }
      }
    }
    
    return bestPractices;
  }

  /**
   * 获取避免事项
   */
  getAvoidances(taskType = null) {
    const avoidances = [];
    
    for (const [key, knowledge] of this.knowledgeBase) {
      if (knowledge.pattern.type === this.patternTypes.FAILURE) {
        if (!taskType || knowledge.pattern.signature.startsWith(taskType)) {
          avoidances.push({
            taskPattern: knowledge.pattern.signature,
            failureRate: (knowledge.pattern.failureCount / knowledge.pattern.occurrences * 100).toFixed(2),
            commonErrors: knowledge.pattern.errorPatterns,
            suggestions: knowledge.recommendations
          });
        }
      }
    }
    
    return avoidances;
  }

  /**
   * 清理旧数据
   */
  cleanup(olderThanMs = 86400000) { // 默认24小时
    const cutoffTime = Date.now() - olderThanMs;
    
    // 清理旧经验
    for (const [id, experience] of this.experiences) {
      if (experience.timestamp < cutoffTime) {
        // 从分类数组中移除
        const successIndex = this.successfulExperiences.findIndex(e => e.id === id);
        if (successIndex !== -1) this.successfulExperiences.splice(successIndex, 1);
        
        const failIndex = this.failedExperiences.findIndex(e => e.id === id);
        if (failIndex !== -1) this.failedExperiences.splice(failIndex, 1);
        
        this.experiences.delete(id);
      }
    }
  }
}

// 默认导出
export default ExperienceAccumulator;