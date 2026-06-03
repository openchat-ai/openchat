import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EvolutionMemory } from './evolution-memory.js';

const EXPERIENCES_FILE = path.join(os.homedir(), '.openchat', 'memory', 'evolution-experiences.json');
import SkillManager from './skill-manager.js';
import logger from '../monitoring/logger.js';

export class EvolutionEngine {
  constructor() {
    this.experiences = [];
    this.skillManager = new SkillManager(); // 使用持久化的 SkillManager
    this.memory = new EvolutionMemory(); // 添加记忆系统
    this.loadExperiences();  // 加载已有经验
    this.loadSkills();       // 加载已有 Skills
  }

  // 任务完成后分析经验
  async analyzeExperience(task, result, context = {}) {
    const experience = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      task,
      result,
      context,
      timestamp: Date.now(),
      success: this.isTaskSuccessful(result),
      metrics: this.extractMetrics(result)
    };

    this.experiences.push(experience);
    await this.saveExperiences();

    // 检查是否有可进化的机会
    await this.checkForEvolutionOpportunities();

    // 将重要信息添加到记忆中
    if (experience.success) {
      this.memory.remember(`successful_task:${task}`, experience, { type: 'experience', success: true });
    } else {
      this.memory.remember(`failed_task:${task}`, experience, { type: 'experience', success: false });
    }
  }

  // 判断任务是否成功
  isTaskSuccessful(result) {
    if (typeof result === 'string') {
      return !result.toLowerCase().includes('error') && 
             !result.toLowerCase().includes('failed') &&
             result.length > 10; // 简单判断：长度大于10且无错误词
    }
    return result && result.content && result.content.length > 0;
  }

  // 判断是否需要记录失败信息
  shouldLogFailure(result) {
    // 对于API错误等常见错误，降低记录频率
    if (typeof result === 'string') {
      const errorIndicators = ['400', 'error', 'failed', 'timeout', 'connection', 'api'];
      return errorIndicators.some(indicator => 
        result.toLowerCase().includes(indicator)
      ) && Math.random() > 0.7; // 隨机记录，避免过多日志
    }
    return true;
  }

  // 提取任务指标
  extractMetrics(result) {
    if (typeof result === 'string') {
      return {
        length: result.length,
        wordCount: result.split(/\s+/).length,
        hasCode: result.includes('```') || result.includes('function'),
        hasSteps: (result.match(/step|first|then|finally/gi) || []).length
      };
    }
    return { length: 0, wordCount: 0, hasCode: false, hasSteps: 0 };
  }

  // 检查进化机会
  async checkForEvolutionOpportunities() {
    // 检查是否有重复任务模式
    const recentTasks = this.experiences.slice(-10);
    const taskPatterns = this.findTaskPatterns(recentTasks);
    
    if (taskPatterns.length > 0) {
      await this.generateSkillsFromPatterns(taskPatterns);
    }
  }

  // 查找任务模式
  findTaskPatterns(experiences) {
    const taskGroups = {};
    
    experiences.forEach(exp => {
      const group = exp.task.substring(0, 20).toLowerCase(); // 简单分组
      if (!taskGroups[group]) taskGroups[group] = [];
      taskGroups[group].push(exp);
    });
    
    // 返回重复3次以上的任务组
    return Object.entries(taskGroups)
      .filter(([_, tasks]) => tasks.length >= 2)
      .map(([group, tasks]) => ({ group, tasks, count: tasks.length }));
  }

  // 从模式生成技能
  async generateSkillsFromPatterns(patterns) {
    for (const pattern of patterns) {
      const skillName = `skill_${pattern.group.replace(/\s+/g, '_')}`;
      const successRate = pattern.tasks.filter(t => t.success).length / pattern.tasks.length;

      if (successRate >= 0.6) { // 成功率60%以上
        const skill = {
          name: skillName,
          description: `针对任务模式: ${pattern.group}`,
          successRate,
          tasks: pattern.tasks.length,
          createdAt: new Date().toISOString()
        };

        this.skillManager.addSkill(skillName, skill);
      }
    }

    // 保存 Skills 到磁盘
    try {
      await this.skillManager.saveSkills();
    } catch (error) {
      logger.error('Failed to save skills:', error);
    }
  }

  // 获取可用技能
  getAvailableSkills(task) {
    const matchingSkills = [];
    const taskLower = task.toLowerCase();
    const allSkills = this.skillManager.getAllSkills();

    allSkills.forEach(skill => {
      if (taskLower.includes(skill.description.toLowerCase().split(':')[1] || '')) {
        matchingSkills.push(skill);
      }
    });

    return matchingSkills.sort((a, b) => b.successRate - a.successRate);
  }

  // 保存经验到独立文件（不再塞进 config.json）
  async saveExperiences() {
    try {
      const dir = path.dirname(EXPERIENCES_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(EXPERIENCES_FILE, JSON.stringify(this.experiences.slice(-100), null, 2));
    } catch (e) {
      // 保存失败不影响主流程
    }
  }

  // 加载已有经验
  loadExperiences() {
    try {
      if (fs.existsSync(EXPERIENCES_FILE)) {
        const raw = fs.readFileSync(EXPERIENCES_FILE, 'utf8');
        this.experiences = JSON.parse(raw);
      } else {
        this.experiences = [];
      }
    } catch (e) {
      this.experiences = [];
    }
  }

  // 加载已有 Skills
  async loadSkills() {
    try {
      await this.skillManager.loadSkills();
    } catch (error) {
      logger.error('Failed to load skills:', error);
    }
  }

  // 获取进化统计
  getStats() {
    const total = this.experiences.length;
    const successful = this.experiences.filter(e => e.success).length;
    const successRate = total > 0 ? (successful / total * 100).toFixed(1) : 0;

    return {
      totalExperiences: total,
      successfulExperiences: successful,
      successRate: parseFloat(successRate),
      skillsCount: this.skillManager.getAllSkills().length,
      recentPatterns: this.findTaskPatterns(this.experiences.slice(-20))
    };
  }
}

// 迭代2: 监控和可观测性
class SystemMonitor {
  constructor() {
    this.events = [];
    this.alerts = [];
    this.thresholds = {
      latency: 1000,
      errorRate: 0.05,
      memoryUsage: 0.8
    };
  }

  /**
   * 记录系统事件
   */
  recordEvent(eventType, data) {
    this.events.push({
      timestamp: new Date().toISOString(),
      type: eventType,
      data,
      id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    });

    if (this.events.length > 10000) {
      this.events = this.events.slice(-5000);
    }

    return this.events[this.events.length - 1].id;
  }

  /**
   * 检查并生成告警
   */
  checkThresholds(metrics) {
    const issues = [];

    if (metrics.latency > this.thresholds.latency) {
      issues.push({ type: 'LATENCY', value: metrics.latency, threshold: this.thresholds.latency });
    }
    if (metrics.errorRate > this.thresholds.errorRate) {
      issues.push({ type: 'ERROR_RATE', value: metrics.errorRate, threshold: this.thresholds.errorRate });
    }
    if (metrics.memoryUsage > this.thresholds.memoryUsage) {
      issues.push({ type: 'MEMORY', value: metrics.memoryUsage, threshold: this.thresholds.memoryUsage });
    }

    if (issues.length > 0) {
      this.alerts.push({
        timestamp: new Date().toISOString(),
        issues,
        severity: issues.some(i => i.type === 'LATENCY') ? 'HIGH' : 'MEDIUM'
      });
    }

    return issues;
  }

  /**
   * 获取系统健康状态
   */
  getHealthStatus() {
    const recentEvents = this.events.slice(-100);
    const recentAlerts = this.alerts.slice(-10);

    return {
      totalEvents: this.events.length,
      recentEventsCount: recentEvents.length,
      activeAlerts: recentAlerts.length,
      eventTypes: [...new Set(recentEvents.map(e => e.type))],
      lastEvent: recentEvents[recentEvents.length - 1]?.timestamp
    };
  }
}

// 迭代5: 错误恢复增强
class RobustErrorHandler {
  constructor() {
    this.errorLog = [];
    this.recoveryStrategies = new Map();
  }

  /**
   * 记录错误并尝试恢复
   * @param {Error} error - 发生的错误
   * @param {Function} recoveryFn - 恢复函数
   * @returns {Promise<any>} 恢复结果
   */
  async handleAndRecover(error, recoveryFn) {
    this.errorLog.push({
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack,
      severity: this.assessSeverity(error)
    });

    if (this.errorLog.length > 1000) {
      this.errorLog = this.errorLog.slice(-500);
    }

    try {
      return await recoveryFn();
    } catch (recoveryError) {
      logger.error('Recovery failed:', recoveryError);
      throw error;
    }
  }

  /**
   * 评估错误严重程度
   */
  assessSeverity(error) {
    const message = error.message.toLowerCase();
    if (message.includes('critical') || message.includes('fatal')) return 'CRITICAL';
    if (message.includes('error') || message.includes('fail')) return 'HIGH';
    if (message.includes('warning')) return 'MEDIUM';
    return 'LOW';
  }

  getErrorReport() {
    return {
      total: this.errorLog.length,
      bySeverity: {
        critical: this.errorLog.filter(e => e.severity === 'CRITICAL').length,
        high: this.errorLog.filter(e => e.severity === 'HIGH').length,
        medium: this.errorLog.filter(e => e.severity === 'MEDIUM').length,
        low: this.errorLog.filter(e => e.severity === 'LOW').length,
      }
    };
  }
}