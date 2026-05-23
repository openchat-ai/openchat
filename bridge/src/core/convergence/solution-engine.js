/**
 * SolutionEngine — 居民并行求解引擎
 *
 * 流程：
 *   1. 接收 Problem（含 N 个布尔子问题）
 *   2. 分配子问题给可用居民（按 traits 匹配）
 *   3. 居民独立求解 → 返回 { answer: 0|1, method, size }
 *   4. 同子问题的多个答案一致 → 验证通过
 *   5. 答案不一致 → 多人重解直到共识
 *
 * 约束：
 *   - 每个子问题至少 2 个居民独立验证
 *   - 答案一致性 = 正确性保证（真理唯一）
 *   - 同正确性解法中选字节数最小的
 */

class SolutionEngine {
  constructor(options = {}) {
    this.verificationThreshold = options.verificationThreshold || 2;  // 至少 2 人答案一致
    this.maxRetries = options.maxRetries || 3;                         // 不一致时重试次数
    this.activeProblems = new Map();                                   // problemId → Problem
  }

  /**
   * 提交一个新问题，让居民求解
   * @param {object} problem       — ProblemDecomposer.decompose() 的输出
   * @param {function} solverFn    — (resident, subQuestion) => { answer, method, size }
   * @param {function} notifyFn    — (event, data) 进度回调
   */
  async solve(problem, solverFn, notifyFn = () => {}) {
    this.activeProblems.set(problem.id, problem);
    notifyFn('problem_started', { problemId: problem.id, total: problem.total });

    // 逐个处理子问题（实际可并行，但保留顺序以简化）
    for (let i = 0; i < problem.subQuestions.length; i++) {
      const sq = problem.subQuestions[i];
      await this.solveSubQuestion(problem.id, sq, solverFn, notifyFn);
    }

    // 检查是否全部解答
    const answered = problem.subQuestions.filter(q => q.solved).length;
    if (answered >= problem.total * 0.8) { // 80%解答率 = 足以输出
      problem.status = 'solved';
    }
    notifyFn('problem_finished', { problemId: problem.id, answered, total: problem.total });
    return problem;
  }

  /**
   * 让多个居民独立求解一个子问题
   */
  async solveSubQuestion(problemId, subQuestion, solverFn, notifyFn) {
    const solutions = [];
    let consensus = false;
    let retries = 0;

    while (!consensus && retries < this.maxRetries) {
      const result = await solverFn(subQuestion);
      if (!result) continue;

      solutions.push({
        answer: result.answer,
        method: result.method,
        size: result.size,
        residentId: result.residentId,
        residentName: result.residentName,
        timestamp: Date.now(),
      });

      // 检查共识：至少 verificationThreshold 个相同答案
      const counts = {};
      for (const s of solutions) counts[s.answer] = (counts[s.answer] || 0) + 1;
      const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];

      if (majority && majority[1] >= this.verificationThreshold) {
        consensus = true;
        subQuestion.answer = parseInt(majority[0]);
        subQuestion.solved = true;
        subQuestion.solutions = solutions;
        notifyFn('sub_question_solved', {
          problemId,
          subQuestionId: subQuestion.id,
          answer: subQuestion.answer,
          consensusCount: majority[1],
          topSize: Math.min(...solutions.filter(s => s.answer === subQuestion.answer).map(s => s.size)),
        });
      }
      retries++;
    }

    if (!consensus) {
      subQuestion.answer = -1; // 未能达成共识
      notifyFn('sub_question_failed', { problemId, subQuestionId: subQuestion.id });
    }
  }

  /**
   * 获取问题的最优解（每子问题同答案中选 size 最小的）
   */
  getOptimizedSolutions(problemId) {
    const problem = this.activeProblems.get(problemId);
    if (!problem) return [];

    return problem.subQuestions
      .filter(q => q.solved && q.answer !== -1)
      .map(q => {
        const correct = q.solutions.filter(s => s.answer === q.answer);
        const best = correct.sort((a, b) => a.size - b.size)[0];
        return {
          subQuestionId: q.id,
          question: q.question,
          answer: q.answer,
          bestMethod: best.method,
          bestSize: best.size,
          bestResident: best.residentName,
        };
      });
  }
}

export { SolutionEngine };
export default SolutionEngine;
