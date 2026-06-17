import { EvolutionSystem } from '../evolution/evolution-system.js';

async function runFullIntegrationTests() {
  console.debug('🧪 开始 Phase 6 完整系统集成测试...\n');
  let testsPassed = 0;
  let testsFailed = 0;

  // 测试 1: 系统初始化
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    if (system.isInitialized) {
      console.debug('✅ 系统初始化 - 通过');
      testsPassed++;
    } else {
      throw new Error('系统未正确初始化');
    }
  } catch (error) {
    console.debug('❌ 系统初始化 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 2: 添加 Skill
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    const result = await system.addSkill('test-skill-1', {
      name: '测试技能',
      description: '这是一个测试技能',
      code: 'function test() { return "Hello World"; }',
    });

    if (result.success && result.skillId === 'test-skill-1') {
      console.debug('✅ 添加 Skill - 通过');
      testsPassed++;
    } else {
      throw new Error('Skill 添加失败');
    }
  } catch (error) {
    console.debug('❌ 添加 Skill - 失败:', error.message);
    testsFailed++;
  }

  // 测试 3: 执行 Skill
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    // 先添加一个 Skill
    await system.addSkill('exec-test', {
      name: '执行测试技能',
      description: '用于测试执行',
      code: 'console.debug("test");',
    });

    // 然后执行它
    const result = await system.executeSkill('exec-test', { test: true });

    if (result.success && result.skillId === 'exec-test') {
      console.debug('✅ 执行 Skill - 通过');
      testsPassed++;
    } else {
      throw new Error('Skill 执行失败');
    }
  } catch (error) {
    console.debug('❌ 执行 Skill - 失败:', error.message);
    testsFailed++;
  }

  // 测试 4: 创建工作会话
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    const session = await system.createSession({
      taskName: '测试任务',
      priority: 'high',
    });

    if (session && session.id) {
      console.debug('✅ 创建工作会话 - 通过');
      testsPassed++;
    } else {
      throw new Error('会话创建失败');
    }
  } catch (error) {
    console.debug('❌ 创建工作会话 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 5: 保存会话
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    const session = await system.createSession({
      data: 'test',
    });

    await system.saveSession(session.id);

    console.debug('✅ 保存工作会话 - 通过');
    testsPassed++;
  } catch (error) {
    console.debug('❌ 保存工作会话 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 6: 获取系统状态
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    const status = system.getStatus();

    if (status && status.isInitialized && status.skills !== undefined) {
      console.debug('✅ 获取系统状态 - 通过');
      testsPassed++;
    } else {
      throw new Error('系统状态获取失败');
    }
  } catch (error) {
    console.debug('❌ 获取系统状态 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 7: 生成系统报告
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    const report = await system.generateReport();

    if (report && report.includes('OpenChat')) {
      console.debug('✅ 生成系统报告 - 通过');
      testsPassed++;
    } else {
      throw new Error('报告生成失败');
    }
  } catch (error) {
    console.debug('❌ 生成系统报告 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 8: 安全检查
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    // 添加一个不安全的 Skill
    const result = await system.addSkill('unsafe-skill', {
      name: '不安全技能',
      code: 'exec("rm -rf /");',
    });

    if (!result.success || result.securityStatus === 'violation') {
      console.debug('✅ 安全检查 - 通过');
      testsPassed++;
    } else {
      throw new Error('安全检查失败，不安全代码未被检测');
    }
  } catch (error) {
    console.debug('❌ 安全检查 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 9: 系统关闭
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    await system.close();

    console.debug('✅ 系统关闭 - 通过');
    testsPassed++;
  } catch (error) {
    console.debug('❌ 系统关闭 - 失败:', error.message);
    testsFailed++;
  }

  // 输出测试结果
  console.debug('\n' + '='.repeat(50));
  console.debug(`总计: ${testsPassed + testsFailed} 个测试`);
  console.debug(`✅ 通过: ${testsPassed}`);
  console.debug(`❌ 失败: ${testsFailed}`);
  console.debug('='.repeat(50));

  return testsFailed === 0;
}

runFullIntegrationTests().then(success => process.exit(success ? 0 : 1));
