import logger from '../logger.js';
/** * VariantGenerator ?（） * * ，? * ，? */

export class VariantGenerator {
  constructor() {
    this._generatedCount = 0;
  }

  /** * ? * @param {Array} solved - [{question, answer, domain}, ...] * @param {number} countPerType - ? * @returns {Array} ? */
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

  /** * */
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

  /** * ：?0% ? */
  _vary(n) {
    if (n === 0) return Math.floor(Math.random() * 5) + 1;
    const factor = 0.5 + Math.random() * 0.6; // 0.5 ~ 1.1
    const result = Math.round(n * factor);
    return Math.max(1, Math.min(999, result)); // 1~999
  }

  /** * （） */
  _replaceNums(question, newNums) {
    let result = question;
    let idx = 0;
    return result.replace(/\d+/g, () => {
      const n = newNums[idx];
      idx++;
      return String(n !== undefined ? n : 0);
    });
  }

  /** * （，） */
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

      //
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

      //
      if (origNums.length === 1 && newNums.length === 1) {
        const factor = origAns / origNums[0];
        if (factor > 0 && Math.abs(factor - Math.round(factor)) < 0.01) {
          return newNums[0] * factor;
        }
      }

      //
      if (origNums.length >= 2) {
        const scale = origAns / (origNums[0] || 1);
        if (!isNaN(scale)) return newNums[0] * scale;
      }
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }

    return null;
  }

  /** */
  count() {
    return this._generatedCount;
  }
}

export default VariantGenerator;
