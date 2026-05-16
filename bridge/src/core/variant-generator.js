/**
 * VariantGenerator — 问题变体生成器（纯内存）
 *
 * 从已解题目中提取结构，替换数字生成变体。
 * 全部在内存中操作，不落盘。
 */

export class VariantGenerator {
  constructor() {
    this._generatedCount = 0;
  }

  /**
   * 从已解题目生成变体
   * @param {Array} solved - [{question, answer, domain}, ...]
   * @param {number} countPerType - 每类型生成几个变体
   * @returns {Array} 生成的变体列表
   */
  generate(solved, countPerType = 3) {
    if (!solved || solved.length === 0) return [];

    const generated = [];
    const seenQs = new Set(solved.map(p => p.question)); // exact match only

    for (const p of solved) {
      if (!p.question || p.answer === null || p.answer === undefined) continue;

      const variants = this._generateVariants(p, countPerType, seenQs);
      for (const v of variants) {
        generated.push(v);
        seenQs.add(v.question);
      }
    }

    this._generatedCount += generated.length;
    return generated;
  }

  /**
   * 生成单道题的变体
   */
  _generateVariants(problem, count, seenQs) {
    const nums = problem.question.match(/\d+/g)?.map(Number) || [];
    if (nums.length === 0) return [];

    const domain = problem.domain || 'math';
    const variants = [];
    let attempts = 0;

    while (variants.length < count && attempts < 30) {
      attempts++;
      const newNums = nums.map(n => this._vary(n));
      if (newNums.every((n, i) => n === nums[i])) continue;

      const newQ = this._replaceNums(problem.question, newNums);
      if (seenQs.has(newQ)) continue;

      const newAns = this._recompute(problem, newNums);
      if (newAns === null) continue;

      variants.push({
        id: `variant_${problem.id || 'p'}_${variants.length}`,
        question: newQ,
        domain,
        difficulty: problem.difficulty || 2,
        answer: newAns,
        parentId: problem.id || '',
        generated: true
      });
    }

    return variants;
  }

  /**
   * 数字扰动：±50% 范围内随机
   */
  _vary(n) {
    if (n === 0) return Math.floor(Math.random() * 5) + 1;
    const factor = 0.5 + Math.random() * 0.6; // 0.5 ~ 1.1
    const result = Math.round(n * factor);
    return Math.max(1, Math.min(999, result)); // 1~999
  }

  /**
   * 模板替换数字（保持顺序）
   */
  _replaceNums(question, newNums) {
    let result = question;
    let idx = 0;
    return result.replace(/\d+/g, () => {
      const n = newNums[idx];
      idx++;
      return String(n !== undefined ? n : 0);
    });
  }

  /**
   * 重新计算答案（用归纳发现的公式，或简单推算）
   */
  _recompute(problem, newNums) {
    try {
      const origNums = problem.question.match(/\d+/g)?.map(Number) || [];
      const origAns = parseFloat(problem.answer);
      if (isNaN(origAns) || origNums.length === 0) return null;

      // 模式1: 三数模式 (a-b+c, a+b-c, a+b+c, a×b÷c)
      if (origNums.length >= 3 && newNums.length >= 3) {
        const abc = origNums[0] - origNums[1] + origNums[2];
        if (Math.abs(origAns - abc) < 0.01) return newNums[0] - newNums[1] + newNums[2];
        const apbmc = origNums[0] + origNums[1] - origNums[2];
        if (Math.abs(origAns - apbmc) < 0.01) return newNums[0] + newNums[1] - newNums[2];
        const sum3 = origNums[0] + origNums[1] + origNums[2];
        if (Math.abs(origAns - sum3) < 0.01) return newNums[0] + newNums[1] + newNums[2];
        if (origNums[2] !== 0) {
          const muldiv = origNums[0] * origNums[1] / origNums[2];
          if (Math.abs(origAns - muldiv) < 0.01) return newNums[0] * newNums[1] / newNums[2];
        }
      }

      // 模式2: 两数模式
      if (origNums.length === 2 && newNums.length === 2) {
        const sum = origNums[0] + origNums[1];
        const diff = Math.abs(origNums[0] - origNums[1]);
        const prod = origNums[0] * origNums[1];
        const quot = origNums[0] / origNums[1];

        if (Math.abs(origAns - sum) < 0.01) return newNums[0] + newNums[1];
        if (Math.abs(origAns - diff) < 0.01) return Math.abs(newNums[0] - newNums[1]);
        if (Math.abs(origAns - prod) < 0.01) return newNums[0] * newNums[1];
        if (Math.abs(origAns - quot) < 0.01) return newNums[0] / newNums[1];
      }

      // 模式3: 1+2+...+n 高斯求和
      if (origNums.length === 1 && newNums.length === 1) {
        const gauss = origNums[0] * (origNums[0] + 1) / 2;
        if (Math.abs(origAns - gauss) < 0.01) return newNums[0] * (newNums[0] + 1) / 2;
      }

      // 模式4: 简单倍数关系
      if (origNums.length === 1 && newNums.length === 1) {
        const factor = origAns / origNums[0];
        if (factor > 0 && Math.abs(factor - Math.round(factor)) < 0.01) {
          return newNums[0] * factor;
        }
      }

      // 模式5: 比例缩放
      if (origNums.length >= 2) {
        const scale = origAns / (origNums[0] || 1);
        if (!isNaN(scale)) return newNums[0] * scale;
      }
    } catch {}

    return null;
  }

  /** 获取已生成的数量 */
  count() {
    return this._generatedCount;
  }
}

export default VariantGenerator;
