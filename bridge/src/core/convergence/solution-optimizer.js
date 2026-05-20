/**
 * SolutionOptimizer — 解法优化器
 *
 * 原则：真理唯一，解法可以有多个。
 * 在答案相同的解法中，选择存储/计算开销最小的。
 *
 * 衡量维度：
 *   - size:    解法本身的字节数（代码/算法长度）
 *   - speed:   执行时间（毫秒）
 *   - memory:  内存占用（字节）
 *   - combined: 加权综合分
 */

class SolutionOptimizer {
  constructor(options = {}) {
    this.sizeWeight     = options.sizeWeight     || 0.5;  // 存储权重
    this.speedWeight    = options.speedWeight    || 0.3;  // 速度权重
    this.memoryWeight   = options.memoryWeight   || 0.2;  // 内存权重
  }

  /**
   * 从多个解法中选最优
   * @param {Array} solutions — [{ answer, method, size, speed, memory, residentId }]
   * @param {number} correctAnswer — 正确答案（0 或 1）
   * @returns {{ winner, rank[] }}
   */
  selectBest(solutions, correctAnswer) {
    // ① 过滤出答案正确的解法
    const correct = solutions.filter(s => s.answer === correctAnswer);
    if (correct.length === 0) return { winner: null, rank: [], reason: '无正确解法' };

    // ② 如果只有一个正确解法 → 直接赢
    if (correct.length === 1) return { winner: correct[0], rank: correct };

    // ③ 多个正确解法 → 综合评分
    const ranked = correct.map(s => ({
      ...s,
      score: this.computeScore(s),
    })).sort((a, b) => a.score - b.score);

    return { winner: ranked[0], rank: ranked };
  }

  /**
   * 计算综合评分（越小越好）
   */
  computeScore(solution) {
    const size   = solution.size   || 0;
    const speed  = solution.speed  || 0;
    const memory = solution.memory || 0;

    // 归一化（粗略，实际应用时可以基于 最大值/中位数 归一化）
    return (
      this.sizeWeight   * Math.log2(size + 1) +
      this.speedWeight  * Math.log2(speed + 1) +
      this.memoryWeight * Math.log2(memory + 1)
    );
  }

  /**
   * 比较两个解法，返回优劣
   */
  compare(a, b) {
    return this.computeScore(a) - this.computeScore(b);
  }

  /**
   * 批量优化 — 对整个 Problem 的所有子问题选最优解法
   * @param {Array} subQuestions — [{ id, answer, solutions[] }]
   * @returns {{ optimized[], totalSavings }}
   */
  optimizeAll(subQuestions) {
    let totalSavings = 0;
    const optimized = [];

    for (const sq of subQuestions) {
      if (!sq.solved || sq.answer === -1 || !sq.solutions?.length) continue;

      const result = this.selectBest(sq.solutions, sq.answer);
      if (!result.winner) continue;

      const worst = result.rank[result.rank.length - 1];
      const savings = (worst ? worst.size : 0) - result.winner.size;
      totalSavings += savings;

      optimized.push({
        subQuestionId: sq.id,
        question: sq.question,
        answer: sq.answer,
        winnerMethod: result.winner.method,
        winnerSize: result.winner.size,
        winnerResident: result.winner.residentId,
        alternatives: result.rank.length - 1,
        savings,
      });
    }

    return { optimized, totalSavings };
  }
}

export { SolutionOptimizer };
export default SolutionOptimizer;
