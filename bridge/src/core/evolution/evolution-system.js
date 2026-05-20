/**
 * EvolutionSystem 类：综合自进化系统集成
 *
 * 整合所有Phase 1-5的模块：
 * - SkillManager: Skill 持久化
 * - Logger: 结构化日志
 * - PersistentSessionManager: 会话持久化
 * - SecurityChecker: 安全审查
 * - EvolutionEngine: 进化引擎
 *
 * 整合所有Phase 3-4的模块：
 * - AutoRestartManager: 自动重启机制
 * - SandboxManager: 沙箱测试环境
 * - AutoRollbackManager: 自动回滚
 * - TestOrchestrator: 测试流程编排
 * - IntelligenceCollector: 技术情报收集
 * - Monitor: 系统监控和告警
 */

import SkillManager from './skill-manager.js';
import PersistentSessionManager from '../persistent-session-manager.js';
import SecurityChecker from '../security/security-checker.js';
import { EvolutionEngine } from './evolution-engine.js';
import AutoRestartManager from '../monitoring/auto-restart-manager.js';
import SandboxManager from '../security/sandbox-manager.js';
import AutoRollbackManager from '../monitoring/auto-rollback-manager.js';
import TestOrchestrator from '../quality/test-orchestrator.js';
import IntelligenceCollector from '../memory/intelligence-collector.js';
import Monitor from '../monitoring/monitor.js';
import logger from '../monitoring/logger.js';

export class EvolutionSystem {
  constructor() {
    // 初始化 Phase 1-2 子系统
    this.skillManager = new SkillManager();
    this.logger = logger;
    this.sessionManager = new PersistentSessionManager();
    this.securityChecker = new SecurityChecker();
    this.evolutionEngine = new EvolutionEngine();

    // 初始化 Phase 3 自动化子系统
    this.autoRestart = new AutoRestartManager();
    this.sandbox = new SandboxManager();
    this.autoRollback = new AutoRollbackManager();
    this.testOrchestrator = new TestOrchestrator();

    // 🔧 开发模式：根据环境变量启用文件监听
    // 生产模式（默认）：文件监听禁用，避免与热更新冲突
    if (process.env.DEV_MODE === 'true' || process.argv.includes('--dev')) {
      logger.info('🛠️  开发模式：启用文件监听（自动重启）');
      this.autoRestart.enableFileWatching(() => {
        logger.info('📝 文件变化检测到，触发重启...');
      });
    } else {
      logger.info('🚀 生产模式：文件监听已禁用（使用热更新）');
    }

    // 初始化 Phase 4 情报与监控子系统
    this.intelligenceCollector = new IntelligenceCollector();
    this.monitor = new Monitor();

    // 系统状态
    this.isInitialized = false;
    this.startTime = Date.now();
  }

  /**
   * 初始化系统
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      this.logger.info('系统初始化开始', { module: 'EvolutionSystem' });

      // 加载持久化数据
      await this.evolutionEngine.loadSkills();
      const lastSession = await this.sessionManager.restoreLastSession();

      if (lastSession) {
        this.logger.info('会话已恢复', {
          module: 'EvolutionSystem',
          sessionId: lastSession.id,
        });
      }

      this.isInitialized = true;
      this.logger.info('系统初始化完成', { module: 'EvolutionSystem' });
    } catch (error) {
      this.logger.error('系统初始化失败', error);
      throw error;
    }
  }

  /**
   * 执行 Skill（带安全检查）
   * @param {string} skillId - Skill ID
   * @param {object} context - 执行上下文
   * @returns {Promise<object>} 执行结果
   */
  async executeSkill(skillId, context = {}) {
    try {
      const skill = this.skillManager.getSkill(skillId);
      if (!skill) {
        throw new Error(`Skill ${skillId} not found`);
      }

      // 步骤 1: 安全审查
      const securityResult = this.securityChecker.check(skill.code || '');

      if (!this.securityChecker.canExecute(securityResult)) {
        this.logger.warn('Skill 执行被安全检查阻止', {
          skillId,
          securityStatus: securityResult.overallStatus,
        });

        return {
          success: false,
          error: '安全检查失败',
          securityScore: this.securityChecker.calculateSecurityScore(securityResult),
        };
      }

      // 步骤 2: 记录执行开始
      this.logger.info('Skill 执行开始', {
        skillId,
        skillName: skill.name,
      });

      // 步骤 3: 模拟执行（实际执行应由具体实现替换）
      const result = {
        success: true,
        skillId,
        skillName: skill.name,
        executedAt: new Date().toISOString(),
        context,
      };

      // 步骤 4: 分析经验并记录
      await this.evolutionEngine.analyzeExperience(
        `Execute Skill: ${skill.name}`,
        `Skill executed successfully with context: ${JSON.stringify(context)}`
      );

      // 步骤 5: 记录执行完成
      this.logger.info('Skill 执行完成', {
        skillId,
        duration: Date.now() - new Date(result.executedAt).getTime(),
      });

      return result;
    } catch (error) {
      this.logger.error(`Skill 执行失败: ${skillId}`, error);
      return {
        success: false,
        error: error.message,
        skillId,
      };
    }
  }

  /**
   * 添加新 Skill
   * @param {string} skillId - Skill ID
   * @param {object} skillData - Skill 数据
   * @returns {Promise<object>} 添加结果
   */
  async addSkill(skillId, skillData) {
    try {
      // 步骤 1: 安全审查
      const securityResult = this.securityChecker.check(skillData.code || '');
      const securityScore = this.securityChecker.calculateSecurityScore(securityResult);

      // 步骤 2: 添加 Skill
      this.skillManager.addSkill(skillId, {
        ...skillData,
        securityScore,
        securityStatus: securityResult.overallStatus,
      });

      // 步骤 3: 保存到磁盘
      await this.skillManager.saveSkills();

      // 步骤 4: 记录日志
      this.logger.info('新 Skill 已添加', {
        skillId,
        skillName: skillData.name,
        securityScore,
      });

      return {
        success: true,
        skillId,
        securityScore,
        securityStatus: securityResult.overallStatus,
      };
    } catch (error) {
      this.logger.error('添加 Skill 失败', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 创建新工作会话
   * @param {object} data - 会话数据
   * @returns {Promise<object>} 会话对象
   */
  async createSession(data = {}) {
    try {
      const session = this.sessionManager.createSession(null, data);

      this.logger.info('新会话已创建', {
        sessionId: session.id,
      });

      return session;
    } catch (error) {
      this.logger.error('创建会话失败', error);
      throw error;
    }
  }

  /**
   * 保存当前会话
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<void>}
   */
  async saveSession(sessionId) {
    try {
      await this.sessionManager.saveSession(sessionId);
      this.logger.info('会话已保存', { sessionId });
    } catch (error) {
      this.logger.error('保存会话失败', error);
      throw error;
    }
  }

  /**
   * 获取系统状态
   * @returns {object} 系统状态对象
   */
  getStatus() {
    const uptime = Date.now() - this.startTime;

    return {
      isInitialized: this.isInitialized,
      uptime,
      uptimeString: this.formatUptime(uptime),
      skills: {
        total: this.skillManager.getAllSkills().length,
      },
      sessions: {
        total: this.sessionManager.getAllSessions().length,
        active: this.sessionManager.getAllSessions().filter(s => s.metadata.state === 'active').length,
      },
      evolution: this.evolutionEngine.getStats(),
      securityRules: this.securityChecker.getRules().length,
      // Phase 3-4 子系统状态
      autoRestart: this.autoRestart.getStats(),
      sandbox: this.sandbox.getStats(),
      autoRollback: this.autoRollback.getStats(),
      testOrchestrator: this.testOrchestrator.getStats(),
      intelligenceCollector: this.intelligenceCollector.getStats(),
      monitor: this.monitor.getMetrics(),
    };
  }

  /**
   * 格式化运行时间
   * @param {number} ms - 毫秒数
   * @returns {string} 格式化的时间字符串
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 60000) % 60;
    const hours = Math.floor(ms / 3600000);

    return `${hours}h ${minutes}m ${seconds}s`;
  }

  /**
   * 生成系统报告
   * @returns {Promise<string>} 系统报告
   */
  async generateReport() {
    const status = this.getStatus();

    const lines = [
      '╔════════════════════════════════════════════════════════╗',
      '║         OpenChat 自进化系统 - 完整系统报告                  ║',
      '╚════════════════════════════════════════════════════════╝',
      '',
      `初始化状态: ${status.isInitialized ? '✅ 已初始化' : '❌ 未初始化'}`,
      `运行时间: ${status.uptimeString}`,
      '',
      'Phase 1-2 基础设施:',
      `  Skill 总数: ${status.skills.total}`,
      `  工作会话总数: ${status.sessions.total}`,
      `  活跃会话: ${status.sessions.active}`,
      `  安全规则: ${status.securityRules}`,
      '',
      '进化引擎:',
      `  总经验: ${status.evolution.totalExperiences}`,
      `  成功率: ${status.evolution.successRate}%`,
      `  自动生成 Skills: ${status.evolution.skillsCount}`,
      '',
      'Phase 3 自动化系统:',
      `  自动重启 - 总次数: ${status.autoRestart.totalRestarts}`,
      `  沙箱环境 - 总创建: ${status.sandbox.totalSandboxes}`,
      `  自动回滚 - 总次数: ${status.autoRollback.totalRollbacks}`,
      `  测试流程 - 执行次数: ${status.testOrchestrator.totalExecutions}`,
      '',
      'Phase 4 监控系统:',
      `  技术情报 - 收集次数: ${status.intelligenceCollector.totalCollections}`,
      `  系统监控 - 请求总数: ${status.monitor.totalRequests}`,
      `  监控 - 平均延迟: ${status.monitor.averageLatency}ms`,
      `  监控 - 系统成功率: ${status.monitor.successRate}%`,
      '',
    ];

    return lines.join('\n');
  }

  /**
   * 关闭系统并刷新日志
   * @returns {Promise<void>}
   */
  async close() {
    try {
      this.logger.info('系统关闭中...', { module: 'EvolutionSystem' });

      // 保存所有会话
      await this.sessionManager.saveSession();

      // 保存所有 Skills
      await this.skillManager.saveSkills();

      logger.info('✅ 系统已安全关闭');
    } catch (error) {
      logger.error('系统关闭过程中发生错误:', error);
    }
  }
}

export default EvolutionSystem;
