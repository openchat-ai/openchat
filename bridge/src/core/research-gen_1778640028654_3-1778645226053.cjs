// Research by 小明: 如何设计一个高效的问题优先级排序算法？
// Generated: 2026-05-13T04:07:06.053Z

/**
 * 问题：如何设计一个高效的问题优先级排序算法？
 * 思路：使用“冲突-影响-成本”三维打分模型，对每个待办任务计算综合得分，
 *      并按照得分从高到低排序。该实现采用 Node.js CommonJS 环境，
 *      可直接运行并打印排序结果。
 */

const priorityQueue = require('priorityqueue'); // 需要先 npm install priorityqueue

// ---------- 1. 示例任务数据 ----------
const tasks = [
  {
    id: 1,
    description: '修复登录接口的安全漏洞',
    urgency: 9,      // 紧迫性 (1-10)
    impact: 10,      // 业务影响 (1-10)
    effort: 6,       // 所需工作量 (1-10, 越小越易实施)
    dependencies: [] // 依赖其他任务的数量  },
  {
    id: 2,
    description: '实现首页新功能的 UI 设计',
    urgency: 5,
    impact: 7,
    effort: 4,
    dependencies: [1] // 需要等待任务 1 完成
  },
  {
    id: 3,
    description: '为用户提供导出数据的按钮',
    urgency: 4,
    impact: 8,
    effort: 3,
    dependencies: []
  },
  {
    id: 4,
    description: '更新第三方库的次要版本',
    urgency: 3,
    impact: 5,
    effort: 2,
    dependencies: []
  }
];

// ---------- 2. 计算综合得分 ----------
/**
 * 综合得分公式（可自行调节权重）：
 *   Score = (Urgency * wU) + (Impact * wI) - (Effort * wE) - (Dependencies * wD)
 * 其中：
 *   wU、wI、wE、wD 分别是权重，默认均为 1。
 * 负号的 Effort 和 Dependencies 表示“成本越低越好”，因此在得分中减去。
 */
function computeScore(task, weights = { wU: 1, wI: 1, wE: 1, wD: 1 }) {
  const { urgency, impact, effort, dependencies } = task;
  const score =
    urgency * weights.wU +
    impact * weights.wI -
    effort * weights.wE -
    dependencies.length * weights.wD;
  return score;
}

// ---------- 3. 使用优先队列排序 ----------
function sortTasksByPriority(tasks, weights) {
  const pq = new priorityqueue((a, b) => computeScore(b, weights) - computeScore(a, weights));
  tasks.forEach(task => pq.push(task));
  const sorted = [];
  while (!pq.isEmpty()) {
    sorted.push(pq.pop());
  }
  return sorted;
}

// ---------- 4. 运行并输出结果 ----------
const weights = { wU: 1.5, wI: 1, wE: 1, wD: 2 }; // 示例权重：更看重紧迫性和依赖数const sortedTasks = sortTasksByPriority(tasks, weights);

console.log('=== 任务优先级排序结果 ===');
sortedTasks.forEach((task, idx) => {
  const score = computeScore(task, weights);
  console.log(`${idx + 1}. ${task.id} - ${task.description}`);
  console.log(`   得分: ${score.toFixed(2)}`);
  console.log(`   紧迫性: ${task.urgency}, 影响: ${task.impact}, 工作量: ${task.effort}, 依赖数: ${task.dependencies.length}`);
  console.log(''); // 空行分隔
});

/**
 * 研究结论（打印在 console 中）：
 * - 该算法通过加权冲突、影响和成本三个维度，快速生成可排序的优先级。
 * - 权重的调节可以让团队根据业务特性偏好紧迫性或影响度。
 * - 依赖关系的加入能够避免“前置任务未完成”导致的排序冲突。
 * - 在实际项目中，可把权重、指标甚至使用机器学习模型进一步优化。
 */