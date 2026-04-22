import { persistentConfig } from '../core/persistent-config.js';
import { EvolutionMemory } from './evolution-memory.js';

export class EvolutionEngine {
  constructor() {
    this.experiences = [];
    this.skills = new Map(); // 存储进化出的技能
    this.memory = new EvolutionMemory(); // 添加记忆系统
    this.loadExperiences();  // 加载已有经验
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
          createdAt: Date.now()
        };

        this.skills.set(skillName, skill);
      }
    }
  }

  // 获取可用技能
  getAvailableSkills(task) {
    const matchingSkills = [];
    const taskLower = task.toLowerCase();
    
    for (const [name, skill] of this.skills) {
      if (taskLower.includes(skill.description.toLowerCase().split(':')[1])) {
        matchingSkills.push(skill);
      }
    }
    
    return matchingSkills.sort((a, b) => b.successRate - a.successRate);
  }

  // 保存经验到配置
  async saveExperiences() {
    try {
      persistentConfig.setPreference('evolution_experiences', this.experiences.slice(-100));
    } catch (e) {
      // 保存失败不影响主流程
    }
  }

  // 加载已有经验
  loadExperiences() {
    try {
      const saved = persistentConfig.getPreference('evolution_experiences', []);
      this.experiences = saved;
    } catch (e) {
      this.experiences = [];
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
      skillsCount: this.skills.size,
      recentPatterns: this.findTaskPatterns(this.experiences.slice(-20))
    };
  }
}