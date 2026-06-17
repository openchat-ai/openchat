import { EvolutionSystem } from '../evolution/evolution-system.js';
import MultiModelTester from '../quality/multi-model-tester.js';
import AdversarialTest from '../quality/adversarial-test.js';

async function runAdvancedIntegrationTests() {
  console.debug('🧪 开始 Phase 6 高级功能集成测试...\n');
  let testsPassed = 0;
  let testsFailed = 0;

  // 测试 1: MultiModelTester 初始化
  try {
    const tester = new MultiModelTester();
    const models = tester.getModels();

    if (models.length === 6) {
      console.debug('✅ MultiModelTester 初始化 - 通过');
      testsPassed++;
    } else {
      throw new Error('模型列表不正确');
    }
  } catch (error) {
    console.debug('❌ MultiModelTester 初始化 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 2: 单个模型测试
  try {
    const tester = new MultiModelTester();
    const result = tester.testModel('claude-3-5-sonnet', 'Test prompt');

    if (result.success && result.model === 'claude-3-5-sonnet') {
      console.debug('✅ 单个模型测试 - 通过');
      testsPassed++;
    } else {
      throw new Error('模型测试失败');
    }
  } catch (error) {
    console.debug('❌ 单个模型测试 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 3: 交叉验证
  try {
    const tester = new MultiModelTester();
    const result = tester.crossValidate('Test prompt', ['claude-3-5-sonnet', 'gpt-4-turbo']);

    if (result.modelCount === 2 && result.consensus) {
      console.debug('✅ 多模型交叉验证 - 通过');
      testsPassed++;
    } else {
      throw new Error('交叉验证失败');
    }
  } catch (error) {
    console.debug('❌ 多模型交叉验证 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 4: 基准模型对比
  try {
    const tester = new MultiModelTester();
    tester.setBaseline('claude-3-5-sonnet');
    const result = tester.compareWithBaseline('Test prompt');

    if (result.baseline === 'claude-3-5-sonnet' && result.comparisons.length > 0) {
      console.debug('✅ 基准模型对比 - 通过');
      testsPassed++;
    } else {
      throw new Error('基准对比失败');
    }
  } catch (error) {
    console.debug('❌ 基准模型对比 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 5: 模型推荐
  try {
    const tester = new MultiModelTester();
    const result = tester.recommendModel({ prioritize: 'cost' });

    if (result.recommended && result.rationale) {
      console.debug('✅ 智能模型推荐 - 通过');
      testsPassed++;
    } else {
      throw new Error('推荐失败');
    }
  } catch (error) {
    console.debug('❌ 智能模型推荐 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 6: 对抗测试 - 逻辑投毒
  try {
    const test = new AdversarialTest();
    const result = test.testLogicPoisoning('function safe() { return true; }');

    if (result.passed && result.testType === '逻辑投毒') {
      console.debug('✅ 逻辑投毒测试 - 通过');
      testsPassed++;
    } else {
      throw new Error('逻辑投毒测试失败');
    }
  } catch (error) {
    console.debug('❌ 逻辑投毒测试 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 7: 对抗测试 - 提示词注入
  try {
    const test = new AdversarialTest();
    const result = test.testPromptInjection('function safe() { return true; }');

    if (result.testType === '提示词注入') {
      console.debug('✅ 提示词注入测试 - 通过');
      testsPassed++;
    } else {
      throw new Error('注入测试失败');
    }
  } catch (error) {
    console.debug('❌ 提示词注入测试 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 8: 对抗测试 - 边界值攻击
  try {
    const test = new AdversarialTest();
    const code = `
      if (input) {
        const length = input.length;
        if (length > 0) {
          process();
        }
      }
    `;
    const result = test.testBoundaryAttack(code);

    if (result.testType === '边界值攻击') {
      console.debug('✅ 边界值攻击测试 - 通过');
      testsPassed++;
    } else {
      throw new Error('边界值测试失败');
    }
  } catch (error) {
    console.debug('❌ 边界值攻击测试 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 9: 完整对抗测试
  try {
    const test = new AdversarialTest();
    const code = 'function test() { if (x) { return y; } }';
    const result = test.runFullTest(code);

    if (result.totalTests === 3 && result.overallStatus) {
      console.debug('✅ 完整对抗测试 - 通过');
      testsPassed++;
    } else {
      throw new Error('完整测试失败');
    }
  } catch (error) {
    console.debug('❌ 完整对抗测试 - 失败:', error.message);
    testsFailed++;
  }

  // 测试 10: EvolutionSystem 与 MultiModelTester 集成
  try {
    const system = new EvolutionSystem();
    await system.initialize();

    const tester = new MultiModelTester();
    tester.setBaseline('claude-3-5-sonnet');
    const comparisonResult = tester.compareWithBaseline('Integration test');

    if (comparisonResult && system.isInitialized) {
      console.debug('✅ 与 MultiModelTester 集成 - 通过');
      testsPassed++;
    } else {
      throw new Error('集成失败');
    }

    await system.close();
  } catch (error) {
    console.debug('❌ 与 MultiModelTester 集成 - 失败:', error.message);
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

runAdvancedIntegrationTests().then(success => process.exit(success ? 0 : 1));
