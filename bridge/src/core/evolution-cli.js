/**
 * Evolution CLI - 自进化系统命令行接口
 * 提供用户友好的命令来管理和使用系统
 */

import { EvolutionSystem } from './evolution-system.js';
import MultiModelTester from './multi-model-tester.js';
import AdversarialTest from './adversarial-test.js';

class EvolutionCLI {
  constructor() {
    this.system = new EvolutionSystem();
    this.tester = new MultiModelTester();
    this.adversarialTest = new AdversarialTest();
  }

  /**
   * 初始化CLI系统
   * @returns {Promise<void>}
   */
  async init() {
    try {
      await this.system.initialize();
      console.log('✅ 自进化系统已初始化');
    } catch (error) {
      console.error('❌ 系统初始化失败:', error.message);
      throw error;
    }
  }

  /**
   * /skill list - 列出所有 Skills
   */
  skillList() {
    const skills = this.system.skillManager.getAllSkills();
    if (skills.length === 0) {
      console.log('📦 没有 Skills');
      return { success: true, skills: [] };
    }

    console.log(`📦 共 ${skills.length} 个 Skills:\n`);
    skills.forEach(skill => {
      console.log(`  [${skill.id}] ${skill.name}`);
      console.log(`    描述: ${skill.description}`);
      console.log(`    版本: ${skill.version}`);
      console.log(`    安全评分: ${skill.securityScore || '未评分'}`);
      console.log();
    });

    return { success: true, skills };
  }

  /**
   * /skill add <name> <description> - 添加新 Skill
   */
  async skillAdd(name, description, code = '') {
    if (!name || !description) {
      console.log('❌ 用法: /skill add <name> <description> [code]');
      return { success: false };
    }

    const skillId = `skill-${Date.now()}`;
    const result = await this.system.addSkill(skillId, {
      name,
      description,
      code: code || `// Skill: ${name}`,
    });

    if (result.success) {
      console.log(`✅ Skill 已添加: ${result.skillId}`);
      console.log(`   安全评分: ${result.securityScore}/100`);
    } else {
      console.log(`❌ 添加失败: ${result.error}`);
    }

    return result;
  }

  /**
   * /skill exec <skillId> - 执行 Skill
   */
  async skillExec(skillId) {
    if (!skillId) {
      console.log('❌ 用法: /skill exec <skillId>');
      return { success: false };
    }

    const result = await this.system.executeSkill(skillId);
    if (result.success) {
      console.log(`✅ Skill 执行成功: ${skillId}`);
    } else {
      console.log(`❌ 执行失败: ${result.error}`);
    }

    return result;
  }

  /**
   * /test models - 测试所有模型
   */
  testModels() {
    const prompt = '这是一个测试提示词';
    const result = this.tester.crossValidate(prompt);

    console.log(`🧪 多模型交叉验证结果\n`);
    console.log(`  提示词: "${prompt}"`);
    console.log(`  模型数: ${result.modelCount}`);
    console.log(`  共识: ${result.consensus}`);
    console.log(`  平均延迟: ${result.averageLatency.toFixed(2)}ms`);
    console.log(`  平均成本: $${result.averageCost.toFixed(4)}`);
    console.log();

    return result;
  }

  /**
   * /test adversarial <code> - 运行对抗测试
   */
  testAdversarial(code) {
    if (!code) {
      console.log('❌ 用法: /test adversarial <code>');
      return { success: false };
    }

    const result = this.adversarialTest.runFullTest(code);

    console.log(`\n${this.adversarialTest.generateReport(result)}`);

    const recommendations = this.adversarialTest.generateRecommendations(result);
    if (recommendations.length > 0) {
      console.log('建议改进:');
      recommendations.forEach((rec, i) => {
        console.log(`  ${i + 1}. ${rec}`);
      });
    }

    return result;
  }

  /**
   * /monitor - 查看系统监控
   */
  monitor() {
    const status = this.system.getStatus();

    console.log('\n📊 系统状态:\n');
    console.log(`  初始化: ${status.isInitialized ? '✅' : '❌'}`);
    console.log(`  运行时间: ${status.uptimeString}`);
    console.log();
    console.log(`  Skills 总数: ${status.skills.total}`);
    console.log(`  会话总数: ${status.sessions.total}`);
    console.log(`  活跃会话: ${status.sessions.active}`);
    console.log();
    console.log(`  总经验: ${status.evolution.totalExperiences}`);
    console.log(`  成功率: ${status.evolution.successRate}%`);
    console.log(`  技能数: ${status.evolution.skillsCount}`);
    console.log();

    return status;
  }

  /**
   * /report - 生成完整系统报告
   */
  async report() {
    const report = await this.system.generateReport();
    console.log(report);
    return report;
  }

  /**
   * /model recommend <priority> - 推荐最优模型
   */
  modelRecommend(priority = 'quality') {
    const recommendations = {
      speed: { prioritize: 'speed' },
      cost: { prioritize: 'cost' },
      quality: { prioritize: 'quality' },
    };

    const prefs = recommendations[priority] || recommendations.quality;
    const result = this.tester.recommendModel(prefs);

    console.log(`\n🤖 模型推荐 (优先级: ${priority})\n`);
    console.log(`  推荐模型: ${result.recommended}`);
    console.log(`  提供商: ${result.provider}`);
    console.log(`  成本: ${result.cost}`);
    console.log(`  原因: ${result.rationale}`);
    console.log();

    return result;
  }

  /**
   * 显示帮助信息
   */
  help() {
    console.log(`
╔════════════════════════════════════════════════════════╗
║        OpenChat 自进化系统 - 命令行帮助                 ║
╚════════════════════════════════════════════════════════╝

📦 Skill 管理:
  /skill list              - 列出所有 Skills
  /skill add <name> <desc> - 添加新 Skill
  /skill exec <id>         - 执行 Skill

🧪 测试与验证:
  /test models             - 交叉验证所有模型
  /test adversarial <code> - 运行对抗测试

🤖 模型推荐:
  /model recommend [speed|cost|quality] - 推荐最优模型

📊 监控与报告:
  /monitor                 - 查看系统实时状态
  /report                  - 生成完整系统报告

❓ 其他:
  /help                    - 显示此帮助信息
  /exit                    - 关闭系统并退出
    `);
  }

  /**
   * 关闭系统
   */
  async close() {
    console.log('\n🔄 正在关闭系统...');
    await this.system.close();
    console.log('✅ 系统已关闭');
  }
}

export default EvolutionCLI;
