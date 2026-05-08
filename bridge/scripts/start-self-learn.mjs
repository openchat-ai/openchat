/**
 * 启动自学习模块（独立进程）
 * 
 * 每 60 秒发现并提交问题
 */

import { SelfLearner } from '../src/core/self-learner.js';

const learner = new SelfLearner();

console.log('自学习模块启动');
console.log('问题池:', learner.problemPool.length, '题');

async function run() {
  const report = learner.getReport();
  console.log('\n=== 自学习状态 ===');
  console.log('问题池:', report.totalPool, '题');
  console.log('已解决:', report.solved);
  console.log('提交中:', report.submitted);
  console.log('LLM生成:', report.generated);
  console.log('KB领域:', report.kbDomains);
  console.log('KB条目:', report.kbEntries);

  const result = await learner.runLearningRound();
  console.log('\n本轮学习:', JSON.stringify(result));
}

// 立即执行一次
run();

// 每 60 秒执行一次
setInterval(run, 60000);
