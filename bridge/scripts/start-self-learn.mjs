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
  const stats = learner.getStats();
  console.log('\n=== 自学习状态 ===');
  console.log('总问题:', stats.totalProblems);
  console.log('已学习:', stats.learned);
  console.log('待处理:', stats.pending);

  const result = await learner.runLearningRound();
  console.log('\n本轮学习:', result.learned, '题');
}

// 立即执行一次
run();

// 每 60 秒执行一次
setInterval(run, 60000);
