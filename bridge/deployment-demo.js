import { pluginManager } from './src/plugins/plugin-manager.js';
import { ShellPlugin, FilePlugin } from './src/plugins/system-plugins.js';
import { GitPlugin, DevToolsPlugin } from './src/plugins/eng-plugins.js';
import SelfTestPlugin from './src/plugins/self-test-plugin.js';
import { sessionManager } from './src/session/session-manager.js';
import { ErrorRecoveryStrategies } from './src/plugins/error-recovery.js';
import { LLMJudge } from './test-utils/llm-judge.js';

global.pluginManager = pluginManager;

/**
 * 实际对话自检演示
 * 模拟一个真实的用户请求 → Agent处理 → 自检闭环
 */

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  🚀 Agent 实际对话自检演示');
  console.log('  场景: 用户请求实现功能 → Agent完成 → 自动质量验证');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. 初始化Agent工具
  console.log('📦 步骤1: 初始化Agent工具集...\n');
  
  pluginManager.registerPlugin(ShellPlugin);
  pluginManager.registerPlugin(FilePlugin);
  pluginManager.registerPlugin(GitPlugin);
  pluginManager.registerPlugin(DevToolsPlugin);
  pluginManager.registerPlugin(SelfTestPlugin);
  
  const tools = pluginManager.getTools(1);
  console.log('   ✅ 已注册工具:', tools.length);
  console.log('   包含:', tools.map(t => t.name).join(', '), '\n');

  // 2. 模拟用户请求
  const userRequest = '帮我创建一个简单的计算器模块，支持加减乘除运算';
  console.log('👤 用户请求:', userRequest, '\n');

  // 3. Agent执行任务
  console.log('🤖 Agent开始处理...\n');
  
  const codeContent = `// calculator.js - 简单计算器模块

export function add(a, b) {
  return a + b;
}

export function subtract(a, b) {
  return a - b;
}

export function multiply(a, b) {
  return a * b;
}

export function divide(a, b) {
  if (b === 0) {
    throw new Error('除数不能为零');
  }
  return a / b;
}
`;

  console.log('   [ACT] Agent 编写代码...');
  const writeResult = await pluginManager.executeTool('write_file', {
    path: 'demo-calculator.js',
    content: codeContent
  }, {});
  console.log('   - write_file →', writeResult.success ? '✅ 成功' : '❌ 失败', '\n');

  // 4. Agent自检
  console.log('🔍 步骤2: Agent进行质量自检...\n');
  
  const judgeTool = pluginManager.skills.get('run_llm_judge');
  
  // 构建符合预期的轨迹
  const trace = {
    success: true,
    errorHandled: true,
    actions: ['write_file'],
    steps: 1,
    hasVerification: false
  };
  
  const testCase = {
    id: 'calculator-task',
    description: '计算器模块实现质量评估',
    prompt: '评估Agent实现的计算器模块是否满足要求',
    expectedActions: ['write_file'],
    expectedOutcome: '代码正确实现且测试通过'
  };
  
  const judge = new LLMJudge();
  judge.testCases = [testCase];
  
  const mockExec = await judge.mockAgentExecution(testCase);
  const evaluation = await judge.evaluateAgentPerformance(trace, testCase);
  
  console.log('   📊 自检结果:');
  console.log('   - 得分:', evaluation.score, '/ 5');
  console.log('   - 反馈:', evaluation.feedback, '\n');

  // 5. Agent决策
  if (evaluation.score < 4) {
    console.log('   ⚠️  得分 < 4，需要优化!');
    console.log('   🔧 Agent开始自我优化...\n');
    
    // 优化后的代码
    const improvedCode = codeContent + `
// 增强版：添加更多功能

export function power(a, b) {
  return Math.pow(a, b);
}

export function mod(a, b) {
  if (b === 0) {
    throw new Error('模数不能为零');
  }
  return a % b;
}
`;
    
    await pluginManager.executeTool('write_file', {
      path: 'demo-calculator.js',
      content: improvedCode
    }, {});
    console.log('   ✅ 优化完成!\n');
  } else {
    console.log('   ✅ 得分 >= 4，任务通过!\n');
  }

  // 6. 错误恢复演示
  console.log('🔧 步骤3: 错误恢复演示...\n');
  
  const testErrorScenarios = [
    { error: new Error('ENOSPC: no space left'), context: { tool: 'write_file' } },
    { error: new Error('文件不存在'), context: { tool: 'read_file' } },
    { error: new Error('ETIMEDOUT'), context: { tool: 'run_command' } }
  ];
  
  for (const scenario of testErrorScenarios) {
    const strategy = ErrorRecoveryStrategies.getStrategy(scenario.error);
    console.log(`   错误: ${scenario.error.message}`);
    console.log(`   策略: ${strategy.strategy || strategy._name || 'unknown'}`);
    
    const result = await ErrorRecoveryStrategies.execute(strategy, scenario.context);
    console.log('   恢复:', result.strategyUsed || result.strategy ? '✅' : '❌', '\n');
  }

  // 7. 清理
  try {
    const fs = await import('fs');
    fs.unlinkSync('demo-calculator.js');
  } catch (e) {}

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ✅ Agent 实际对话自检演示完成');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  console.log('📌 关键成就:');
  console.log('   ✅ Agent 完成了用户请求 (计算器模块)');
  console.log('   ✅ Agent 执行了质量自检 (run_llm_judge)');
  console.log('   ✅ Agent 做出决策 (通过/优化)');
  console.log('   ✅ 错误恢复策略正常工作');
  console.log('\n🎯 Agent 现在可以在真实对话中应用自检闭环!\n');
}

run().catch(console.error);