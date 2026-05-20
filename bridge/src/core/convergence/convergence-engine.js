import logger from '../monitoring/logger.js';
/**
 * ConvergenceEngine — 分解竞标 + 快速收敛
 *
 * 元问题：一个复杂问题可以有无数种分解方式 → 如何选最优？
 * 答案：让分解本身成为竞标 — 多个居民各自分解，最快的胜出。
 *
 * 流程：
 *   1. 问题发布 → 多个居民提交各自的分解（子问题集）
 *   2. 并行求解各分解 → 计时 + 计资源
 *   3. 最先解完 >80% 子问题的分解 = 获胜
 *   4. 慢的分解直接丢弃（不浪费后续资源）
 *   5. 知识库记录获胜分解的模板 → 下次同类问题秒解
 *
 * 收敛原理：
 *   - 分解过大（8000子问题）→ 超时淘汰
 *   - 分解过小（1个子问题）→ 答案不完整 → 被更好的分解替代
 *   - 分解刚好（3-50子问题）→ 快速收敛 + 答案完整 → 胜出
 */

class ConvergenceEngine {
  constructor(options = {}) {
    this.timeout = options.timeout || 60000;        // 60秒内必须解完80%
    this.minThreshold = options.minThreshold || 0.8; // 80%完成率即判定收敛
    this.activeDecompositions = new Map();            // problemId → [{ id, subQuestions, progress, winner }]
  }

  /**
   * 发布问题 → 收集多个分解 → 竞标求解
   * @param {string} problemId
   * @param {Array} decompositions   — [{ id, resident, subQuestions[] }]
   * @param {function} solverFn      — (subQuestion) => { answer, method, size }
   * @returns {{ winner, all[] }}
   */
  async compete(problemId, decompositions, solverFn) {
    this.activeDecompositions.set(problemId, decompositions.map(d => ({
      ...d,
      answered: 0,
      total: d.subQuestions.length,
      startTime: Date.now(),
      winner: false,
      discarded: false,
    })));

    const entries = this.activeDecompositions.get(problemId);
    const startTime = Date.now();

    // 并行竞赛：每个分解独立求解
    const promises = entries.map(entry => this._solveDecomposition(entry, solverFn));

    // 等待第一个收敛的
    const winner = await Promise.race(promises);

    if (winner) {
      winner.winner = true;
      // 丢弃所有慢的分解（不浪费资源）
      for (const e of entries) {
        if (!e.winner) e.discarded = true;
      }
    }

    const elapsed = Date.now() - startTime;
    return {
      winner,
      all: entries,
      totalCandidates: entries.length,
      elapsed,
      savings: entries.filter(e => e.discarded).length, // 省掉的分解数
    };
  }

  /**
   * 单个分解的求解进程
   */
  async _solveDecomposition(entry, solverFn) {
    const promises = entry.subQuestions.map(async (sq) => {
      if (entry.discarded) return; // 已有胜者，放弃
      try {
        const result = await solverFn(sq);
        entry.answered++;
        sq.answer = result.answer;
        sq.method = result.method;
        sq.size = result.size;

        // 检查收敛条件
        const progress = entry.answered / entry.total;
        const elapsed = Date.now() - entry.startTime;

        if (progress >= this.minThreshold && elapsed < this.timeout) {
          return entry; // 这个分解收敛了
        }
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    });

    // 等全部完成或超时
    await Promise.race([
      Promise.all(promises),
      new Promise(resolve => setTimeout(resolve, this.timeout)),
    ]);

    const progress = entry.answered / entry.total;
    if (progress >= this.minThreshold) return entry;
    return null; // 超时未收敛
  }

  /**
   * 分析收敛质量 → 下次同类问题推荐分解策略
   */
  analyze(problemId) {
    const entries = this.activeDecompositions.get(problemId);
    if (!entries) return null;

    const winner = entries.find(e => e.winner);
    if (!winner) return null;

    return {
      optimalSubQuestionCount: winner.total,
      optimalTime: Date.now() - winner.startTime,
      efficiency: winner.answered / winner.total / ((Date.now() - winner.startTime) / 1000),
      badPatterns: entries.filter(e => e.discarded).map(e => ({
        resident: e.resident,
        subCount: e.total,
        reason: e.total > 100 ? '分解过细' : '太慢',
      })),
    };
  }
}

export { ConvergenceEngine };
export default ConvergenceEngine;
