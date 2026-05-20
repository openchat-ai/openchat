import { EvolutionEngine } from '../evolution-engine.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function runIntegrationTests() {
  console.log('🧪 开始 Phase 6 SkillManager 集成测试...\n');
  let testsPassed = 0;
  let testsFailed = 0;

  // 测试 1: EvolutionEngine 初始化
  try {
    const engine = new EvolutionEngine();
    if (engine.skillManager && engine.experiences !== undefined) {
      console.log('✅ EvolutionEngine 初始化 - 通过');
      testsPassed++;
    } else {
      throw new Error('EvolutionEngine 初始化失败');
    }
  } catch (error) {
    console.log('❌ EvolutionEngine 初始化 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 2: 添加和保存 Skill
  try {
    const engine = new EvolutionEngine();
    engine.skillManager.addSkill('test-skill-1', {
      name: '测试技能',
      description: '这是一个测试技能',
      code: 'function test() { return true; }',
    });

    await engine.skillManager.saveSkills();

    const skillPath = engine.skillManager.getStoragePath();
    if (fs.existsSync(skillPath)) {
      console.log('✅ Skill 保存到磁盘 - 通过');
      testsPassed++;
    } else {
      throw new Error('Skill 文件未创建');
    }
  } catch (error) {
    console.log('❌ Skill 保存到磁盘 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 3: 加载 Skill
  try {
    const engine = new EvolutionEngine();
    await engine.loadSkills();

    const skill = engine.skillManager.getSkill('test-skill-1');
    if (skill && skill.name === '测试技能') {
      console.log('✅ Skill 加载和恢复 - 通过');
      testsPassed++;
    } else {
      throw new Error('Skill 加载失败');
    }
  } catch (error) {
    console.log('❌ Skill 加载和恢复 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 4: 经验分析和 Skill 生成
  try {
    const engine = new EvolutionEngine();

    // 模拟多个成功的任务
    for (let i = 0; i < 5; i++) {
      await engine.analyzeExperience(
        '代码重构',
        '成功完成代码重构，提升了性能 20%'
      );
    }

    const stats = engine.getStats();
    if (stats.totalExperiences >= 5) {
      console.log('✅ 经验分析和统计 - 通过');
      testsPassed++;
    } else {
      throw new Error('经验分析失败');
    }
  } catch (error) {
    console.log('❌ 经验分析和统计 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 5: 获取可用 Skills
  try {
    const engine = new EvolutionEngine();
    await engine.loadSkills();

    const availableSkills = engine.getAvailableSkills('代码重构任务');
    if (Array.isArray(availableSkills)) {
      console.log('✅ 获取可用 Skills - 通过');
      testsPassed++;
    } else {
      throw new Error('获取 Skills 失败');
    }
  } catch (error) {
    console.log('❌ 获取可用 Skills - 失败:', error.message);
    testsFailed++;
  }

  // 测试 6: SkillManager 导入导出
  try {
    const engine = new EvolutionEngine();
    engine.skillManager.addSkill('export-test', {
      name: '导出测试',
      description: '测试导出功能',
    });

    const exported = engine.skillManager.exportAsJSON();
    const engineNew = new EvolutionEngine();
    engineNew.skillManager.importFromJSON(exported);

    const imported = engineNew.skillManager.getSkill('export-test');
    if (imported && imported.name === '导出测试') {
      console.log('✅ SkillManager 导入导出 - 通过');
      testsPassed++;
    } else {
      throw new Error('导入导出失败');
    }
  } catch (error) {
    console.log('❌ SkillManager 导入导出 - 失败:', error.message);
    testsFailed++;
  }

  // 清理测试数据
  try {
    const engine = new EvolutionEngine();
    const skillPath = engine.skillManager.getStoragePath();
    const skillDir = path.dirname(skillPath);
    if (fs.existsSync(skillPath)) {
      fs.unlinkSync(skillPath);
    }
  } catch (e) {
    // 清理失败不影响测试结果
  }

  // 输出测试结果
  console.log('\n' + '='.repeat(50));
  console.log(`总计: ${testsPassed + testsFailed} 个测试`);
  console.log(`✅ 通过: ${testsPassed}`);
  console.log(`❌ 失败: ${testsFailed}`);
  console.log('='.repeat(50));

  return testsFailed === 0;
}

runIntegrationTests().then(success => process.exit(success ? 0 : 1));
