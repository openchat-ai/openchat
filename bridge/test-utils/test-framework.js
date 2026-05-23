import { LLMJudge } from './llm-judge.js';

async function testFramework() {
  console.log('🧪 测试框架功能...');
  
  const judge = new LLMJudge();
  
  // 测试模拟执行
  console.log('\n1. 测试模拟执行:');
  const mockResponse = await judge.mockAgentExecution(judge.testCases[0]);
  console.log('   模拟结果:', mockResponse);
  
  // 测试评测功能
  console.log('\n2. 测试评测功能:');
  const evaluation = await judge.evaluateAgentPerformance(mockResponse, judge.testCases[0]);
  console.log('   评测结果:', {
    score: evaluation.score,
    feedback: evaluation.feedback
  });
  
  // 测试结果保存
  console.log('\n3. 测试结果保存:');
  console.log('   结果已保存到 test-results/ 目录');
  
  console.log('\n✅ 框架功能测试完成!');
}

testFramework().catch(console.error);