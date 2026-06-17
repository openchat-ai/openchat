import EvolutionCLI from '../evolution/evolution-cli.js';

async function runCLIIntegrationTests() {
  console.debug('🧪 开始 Phase 6 CLI 集成测试...\n');
  let testsPassed = 0;
  let testsFailed = 0;

  // 初始化 CLI
  let cli = null;
  try {
    cli = new EvolutionCLI();
    await cli.init();
    console.debug('✅ CLI 初始化 - 通过');
    testsPassed++;
  } catch (error) {
    console.debug('❌ CLI 初始化 - 失败:', error.message);
    testsFailed++;
    process.exit(1);
  }

  // 测试 1: Skill List
  try {
    const result = cli.skillList();
    if (result.success !== undefined) {
      console.debug('✅ /skill list 命令 - 通过');
      testsPassed++;
    } else {
      throw new Error('命令失败');
    }
  } catch (error) {
    console.debug('❌ /skill list 命令 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 2: Skill Add
  try {
    const result = await cli.skillAdd('测试技能', '这是一个测试技能');
    if (result.success) {
      console.debug('✅ /skill add 命令 - 通过');
      testsPassed++;
    } else {
      throw new Error('添加失败');
    }
  } catch (error) {
    console.debug('❌ /skill add 命令 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 3: Test Models
  try {
    const result = cli.testModels();
    if (result && result.modelCount > 0) {
      console.debug('✅ /test models 命令 - 通过');
      testsPassed++;
    } else {
      throw new Error('测试失败');
    }
  } catch (error) {
    console.debug('❌ /test models 命令 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 4: Test Adversarial
  try {
    const result = cli.testAdversarial('function test() { return true; }');
    if (result && result.totalTests > 0) {
      console.debug('✅ /test adversarial 命令 - 通过');
      testsPassed++;
    } else {
      throw new Error('对抗测试失败');
    }
  } catch (error) {
    console.debug('❌ /test adversarial 命令 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 5: Monitor
  try {
    const result = cli.monitor();
    if (result && result.isInitialized) {
      console.debug('✅ /monitor 命令 - 通过');
      testsPassed++;
    } else {
      throw new Error('监控失败');
    }
  } catch (error) {
    console.debug('❌ /monitor 命令 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 6: Report
  try {
    const result = await cli.report();
    if (result && result.includes('OpenChat')) {
      console.debug('✅ /report 命令 - 通过');
      testsPassed++;
    } else {
      throw new Error('报告生成失败');
    }
  } catch (error) {
    console.debug('❌ /report 命令 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 7: Model Recommend
  try {
    const result = cli.modelRecommend('cost');
    if (result && result.recommended) {
      console.debug('✅ /model recommend 命令 - 通过');
      testsPassed++;
    } else {
      throw new Error('推荐失败');
    }
  } catch (error) {
    console.debug('❌ /model recommend 命令 - 失败:', error.message);
    testsFailed++;
  }

  // 关闭 CLI
  try {
    await cli.close();
    console.debug('✅ CLI 关闭 - 通过');
    testsPassed++;
  } catch (error) {
    console.debug('❌ CLI 关闭 - 失败:', error.message);
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

runCLIIntegrationTests().then(success => process.exit(success ? 0 : 1));
