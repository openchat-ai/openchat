import logger from './logger.js';
/**
 * InductiveReasoner — 归纳推理
 *
 * 人类发现定理的方式：
 * 1. 观察特例 → 2. 猜公式 → 3. 验证 → 4. 确认定理
 *
 * 系统已解几十道同类题，完全能从特例中归纳出规律。
 */

export class InductiveReasoner {
  constructor(theoremDB) {
    this.theoremDB = theoremDB;
    this.hypotheses = [];  // 待验证猜想
    this.discovered = [];  // 已验证的新定理
  }

  /**
   * 从多道已解同类题中归纳通式
   * @param {Array} solvedProblems — [{question, answer, domain}, ...]
   */
  hypothesize(solvedProblems) {
    if (solvedProblems.length < 3) return [];
    const discoveries = [];

    // 按题型分组
    const groups = this._groupByType(solvedProblems);
    for (const [type, group] of groups) {
      if (group.length < 3) continue;

      const hypothesis = this._generateHypothesis(type, group);
      if (hypothesis && this._validateHypothesis(hypothesis, group)) {
        hypothesis.verified = true;
        hypothesis.source = 'induction';
        this.discovered.push(hypothesis);
        discoveries.push(hypothesis);
      } else if (hypothesis) {
        // 存为待验证猜想
        this.hypotheses.push(hypothesis);
      }
    }

    return discoveries;
  }

  /**
   * 题型分类
   */
  _groupByType(problems) {
    const groups = new Map();

    for (const p of problems) {
      // 去掉数字，得到题型签名
      const signature = p.question.replace(/\d+/g, '#');

      // 进一步合并：只保留关键结构
      const simplified = this._simplifySignature(signature);

      if (!groups.has(simplified)) groups.set(simplified, []);
      groups.get(simplified).push(p);
    }

    return groups;
  }

  _simplifySignature(sig) {
    return sig
      .replace(/[的，。？！、]/g, '')
      .replace(/\s+/g, '')
      .substring(0, 60);
  }

  /**
   * 从同组特例中猜通式
   */
  _generateHypothesis(type, group) {
    // 提取所有题目中的数字和对应答案
    const cases = [];

    for (const p of group) {
      const nums = p.question.match(/\d+/g)?.map(Number) || [];
      const ansNum = parseFloat(String(p.answer));

      if (nums.length >= 1 && !isNaN(ansNum)) {
        cases.push({ nums, answer: ansNum, question: p.question });
      }
    }

    if (cases.length < 3) return null;

    // 尝试发现公式：answer = f(nums)
    const formula = this._tryFitFormula(cases);
    if (!formula) return null;

    return {
      name: `归纳定理: ${type.substring(0, 30)}`,
      type,
      formula: formula.description,
      compute: formula.fn,
      sampleCount: cases.length,
      samples: cases.slice(0, 3).map(c => c.question),
      verified: false
    };
  }

  /**
   * 尝试拟合多种公式形式
   */
  _tryFitFormula(cases) {
    const testCases = cases.slice(0, Math.min(5, cases.length));

    // 模式1: answer = n[0] + n[1] (两数之和)
    if (testCases.every(c => c.nums.length >= 2 && Math.abs(c.answer - (c.nums[0] + c.nums[1])) < 0.01)) {
      return { description: '两数相加', fn: (nums) => nums[0] + nums[1] };
    }

    // 模式2: answer = n[0] - n[1]
    if (testCases.every(c => c.nums.length >= 2 && Math.abs(c.answer - (c.nums[0] - c.nums[1])) < 0.01)) {
      return { description: '两数相减', fn: (nums) => nums[0] - nums[1] };
    }

    // 模式3: answer = n[0] * n[1]
    if (testCases.every(c => c.nums.length >= 2 && Math.abs(c.answer - c.nums[0] * c.nums[1]) < 0.01)) {
      return { description: '两数相乘', fn: (nums) => nums[0] * nums[1] };
    }

    // 模式4: answer = (n[0] + n[1]) / 2 (和差求大数)
    if (testCases.every(c => c.nums.length >= 2 && Math.abs(c.answer - (c.nums[0] + c.nums[1]) / 2) < 0.01)) {
      return { description: '(a+b)/2 (和差求大数)', fn: (nums) => (nums[0] + nums[1]) / 2 };
    }

    // 模式5: answer = n[0] * (n[0] + 1) / 2 (1+2+...+n)
    if (testCases.every(c => {
      const predicted = c.nums[0] * (c.nums[0] + 1) / 2;
      return Math.abs(c.answer - predicted) < 0.01;
    })) {
      return { description: 'n(n+1)/2 (等差数列求和)', fn: (nums) => nums[0] * (nums[0] + 1) / 2 };
    }

    // 模式6: answer = n[0] * n[1] / n[2] (比例)
    if (testCases.every(c => c.nums.length >= 3 && Math.abs(c.answer - c.nums[0] * c.nums[1] / c.nums[2]) < 0.01)) {
      return { description: '比例交叉相乘', fn: (nums) => nums[0] * nums[1] / nums[2] };
    }

    // 模式7: answer = n[0] / 100 * n[1] (百分比)
    if (testCases.every(c => c.nums.length >= 2 && Math.abs(c.answer - c.nums[0] / 100 * c.nums[1]) < 0.01)) {
      return { description: '百分数计算', fn: (nums) => nums[0] / 100 * nums[1] };
    }

    // 模式8: answer = n[0] * n[1] / 10 (折扣)
    if (testCases.every(c => c.nums.length >= 2 && Math.abs(c.answer - c.nums[0] * c.nums[1] / 10) < 0.01)) {
      return { description: '原价×折扣/10', fn: (nums) => nums[0] * nums[1] / 10 };
    }

    // 模式9: answer = n[0]² * a (面积/体积类)
    for (const coeff of [3.14, Math.PI, 6, 0.5]) {
      if (testCases.every(c => c.nums.length >= 1 && Math.abs(c.answer - c.nums[0] * c.nums[0] * coeff) < 0.02)) {
        return { description: `r²×${coeff}`, fn: (nums) => nums[0] * nums[0] * coeff };
      }
    }

    // 模式10: answer = n[0] × (n[0]-1) / 2 (组合数 C(n,2))
    if (testCases.every(c => {
      const predicted = c.nums[0] * (c.nums[0] - 1) / 2;
      return Math.abs(c.answer - predicted) < 0.01;
    })) {
      return { description: 'C(n,2) 握手问题', fn: (nums) => nums[0] * (nums[0] - 1) / 2 };
    }

    return null;
  }

  /**
   * 验证猜想：所有样本都要通过
   */
  _validateHypothesis(hypothesis, group) {
    if (!hypothesis.compute) return false;
    let passed = 0;
    for (const p of group) {
      const nums = p.question.match(/\d+/g)?.map(Number) || [];
      try {
        const predicted = hypothesis.compute(nums);
        const actual = parseFloat(String(p.answer));
        if (!isNaN(predicted) && !isNaN(actual) && Math.abs(predicted - actual) < 0.01) {
          passed++;
        }
      } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
    }
    return passed === group.length && passed >= 3;
  }

  getStats() {
    return {
      hypotheses: this.hypotheses.length,
      discovered: this.discovered.length,
      recent: this.discovered.slice(-3).map(d => d.name)
    };
  }
}
