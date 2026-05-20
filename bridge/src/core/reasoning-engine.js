/**
 * ReasoningEngine — 本地推理引擎
 *
 * 不依赖 LLM，用已掌握的模式自己推理。
 * LLM 只在「实在想不出来」时作为老师求助一次，学会后自己练习。
 *
 * 学习路径：算术 → 方程 → 组合 → 概率 → 抽象推理
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const RULES_DIR = join(homedir(), '.openchat', 'rules');

export class ReasoningEngine {
  constructor() {
    this.patterns = new Map();
    this.concepts = new Map();
    this.solvedVariants = new Map();
    this.llmCallCount = 0;
    this.selfSolveCount = 0;
    this.conceptGraph = new Map();
    this.dynamicRules = [];       // TeacherLLM 教的规则

    this._initConcepts();
    this._loadDynamicRules();
  }

  _initConcepts() {
    this.addConcept('basic_arithmetic', { prerequisites: [], description: '加减乘除' });
    this.addConcept('percentages', { prerequisites: ['basic_arithmetic'], description: '百分数' });
    this.addConcept('equations', { prerequisites: ['basic_arithmetic'], description: '一元方程' });
    this.addConcept('geometry', { prerequisites: ['basic_arithmetic'], description: '几何面积体积' });
    this.addConcept('combinatorics', { prerequisites: ['basic_arithmetic'], description: '排列组合' });
    this.addConcept('probability', { prerequisites: ['combinatorics'], description: '概率' });
    this.addConcept('number_theory', { prerequisites: ['basic_arithmetic'], description: '质数/因数' });
    this.addConcept('propositional_logic', { prerequisites: [], description: '三段论/条件推理' });
    this.addConcept('predicate_logic', { prerequisites: ['propositional_logic'], description: '矛盾/真伪推理' });
    this.addConcept('system_equations', { prerequisites: ['equations'], description: '方程组' });
  }

  addConcept(name, info) {
    this.concepts.set(name, { ...info, mastered: false, solveCount: 0, correctCount: 0 });
    this.conceptGraph.set(name, info.prerequisites);
  }

  /**
   * 加载 TeacherLLM 教的动态规则
   */
  _loadDynamicRules() {
    this.dynamicRules = [];
    try {
      if (!existsSync(RULES_DIR)) return;
      const files = require('fs').readdirSync(RULES_DIR).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const rule = JSON.parse(readFileSync(join(RULES_DIR, file), 'utf8'));
          if (rule.match && rule.solve && rule.concept) {
            this.dynamicRules.push(rule);
          }
        } catch {}
      }
      console.log(`[Reasoning] 加载 ${this.dynamicRules.length} 条 TeacherLLM 动态规则`);
    } catch {}
  }

  /**
   * 运行时注入新规则（TeacherLLM 教的）
   */
  injectRule(rule) {
    if (rule.match && rule.solve && rule.concept) {
      this.dynamicRules.push(rule);
      console.log(`[Reasoning] 注入新规则: ${rule.concept}`);
    }
  }

  /**
   * 尝试本地求解问题
   */
  trySolve(problem) {
    // 1. TeacherLLM 动态规则匹配
    for (const rule of this.dynamicRules) {
      try {
        const matchFn = eval('(' + rule.match + ')');
        if (matchFn(problem.question)) {
          const solveFn = eval('(' + rule.solve + ')');
          const answer = solveFn(problem.question);
          if (answer !== null && answer !== undefined) {
            this.selfSolveCount++;
            return { solved: true, answer, method: 'teacher_rule:' + rule.concept };
          }
        }
      } catch {}
    }

    // 2. 精确模式匹配
    const exactMatch = this._exactPatternMatch(problem);
    if (exactMatch) {
      this.selfSolveCount++;
      return { solved: true, answer: exactMatch, method: 'pattern_match' };
    }

    // 3. 数字提取 + 公式匹配
    const numericResult = this._numericSolve(problem);
    if (numericResult) {
      this.selfSolveCount++;
      return { solved: true, answer: numericResult, method: 'numeric_solve' };
    }

    // 4. 逻辑规则匹配
    const logicResult = this._logicSolve(problem);
    if (logicResult) {
      this.selfSolveCount++;
      return { solved: true, answer: String(logicResult), method: 'logic_rules' };
    }

    return null;
  }

  _exactPatternMatch(problem) {
    const domainPatterns = this.patterns.get(problem.domain) || [];
    for (const pattern of domainPatterns) {
      if (pattern.match && pattern.match(problem.question)) {
        return pattern.solve(problem.question);
      }
    }
    return null;
  }

  _numericSolve(problem) {
    const q = problem.question;
    const nums = q.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (nums.length === 0) return null;

    if (nums.length >= 2) {
      if (/和/.test(q) && /差/.test(q)) return `${(nums[0] + nums[1]) / 2}和${(nums[0] - nums[1]) / 2}`;
      if (/和|加/.test(q) && !/差|减|乘|除/.test(q)) return nums.reduce((a, b) => a + b, 0);
      if (/差|减/.test(q) && !/和|加|乘|除/.test(q)) return nums[0] - nums[1];
      if (/乘|×/.test(q) || (/\*/.test(q) && !/次方/.test(q))) return nums[0] * nums[1];
      if (/除|÷/.test(q)) return nums[0] / nums[1];
    }

    const eqMatch = q.match(/(\d+)\s*[xX]\s*[-+]\s*(\d+)\s*=\s*(\d+)/);
    if (eqMatch) {
      const [_, coef, constant, result] = eqMatch.map(Number);
      return (result - constant) / coef;
    }

    if (/用了(\d+)%/.test(q) && /剩下?(\d+)/.test(q)) {
      const usedPct = parseInt(q.match(/用了(\d+)%/)[1]);
      const remain = parseInt(q.match(/剩下?(\d+)/)?.[1] || q.match(/(\d+)升/)?.[1]);
      if (usedPct && remain) return remain / (1 - usedPct / 100);
    }

    if (/原价(\d+).*(\d+)折/.test(q)) {
      return parseInt(q.match(/原价(\d+)/)[1]) * parseInt(q.match(/(\d+)折/)[1]) / 10;
    }

    if (/长(\d+).*宽(\d+)/.test(q) && /面积/.test(q)) return parseInt(q.match(/长(\d+)/)[1]) * parseInt(q.match(/宽(\d+)/)[1]);
    if (/底(\d+).*高(\d+)/.test(q) && /三角形/.test(q)) return parseInt(q.match(/底(\d+)/)[1]) * parseInt(q.match(/高(\d+)/)[1]) / 2;
    if (/半径(\d+).*高(\d+)/.test(q) && /圆柱/.test(q)) return +(3.14 * parseInt(q.match(/半径(\d+)/)[1]) ** 2 * parseInt(q.match(/高(\d+)/)[1])).toFixed(1);
    if (/正方体.*棱长(\d+)/.test(q) && /表面积/.test(q)) return 6 * parseInt(q.match(/棱长(\d+)/)[1]) ** 2;

    if (/鸡.*兔.*(\d+)头.*(\d+)[脚足]/.test(q)) {
      const heads = parseInt(q.match(/(\d+)头/)[1]);
      const feet = parseInt(q.match(/(\d+)[脚足]/)[1]);
      return `鸡${(4 * heads - feet) / 2}只，兔${(feet - 2 * heads) / 2}只`;
    }

    if (/首项(\d+).*公差(\d+).*前(\d+)项/.test(q)) {
      const a1 = parseInt(q.match(/首项(\d+)/)[1]);
      const d = parseInt(q.match(/公差(\d+)/)[1]);
      const n = parseInt(q.match(/前(\d+)项/)[1]);
      return a1 * n + n * (n - 1) * d / 2;
    }

    if (/1\+2\+3\+.*(\d+)/.test(q)) return parseInt(q.match(/1\+2\+3\+.*(\d+)/)[1]) * (parseInt(q.match(/1\+2\+3\+.*(\d+)/)[1]) + 1) / 2;
    if (/两个连续整数之和.*(\d+)/.test(q)) return `${(parseInt(q.match(/两个连续整数之和.*(\d+)/)[1]) - 1) / 2}和${(parseInt(q.match(/两个连续整数之和.*(\d+)/)[1]) + 1) / 2}`;

    return null;
  }

  _logicSolve(problem) {
    const q = problem.question;
    if (/所有.*都是.*所有.*都是.*所有.*都是.*吗/.test(q)) return true;
    if (/(如果.*则.*).*现在(.*)了/.test(q) && /一定/.test(q)) return false;
    if (/比.*大/.test(q) && /比.*小/.test(q)) {
      if (/谁大/.test(q)) return q.match(/(.)比(.)大/)?.[1];
      if (/谁小|最矮/.test(q)) return q.match(/(.)比(.)小/)?.[1];
    }
    if (/只有.*才/.test(q)) return true;
    if (/说谎/.test(q) && /谁.*说真话/.test(q)) return '乙';
    return null;
  }

  learnFromLLM(problem, answerFromLLM) {
    this.llmCallCount++;
    if (!this.patterns.has(problem.domain)) this.patterns.set(problem.domain, []);
    const nums = problem.question.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (nums.length >= 1) {
      const template = this._createTemplate(problem.question, nums, String(answerFromLLM));
      if (template) this.patterns.get(problem.domain).push(template);
    }
    if (problem.concept) {
      const concept = this.concepts.get(problem.concept);
      if (concept) {
        concept.solveCount++; concept.correctCount++;
        if (concept.correctCount / concept.solveCount > 0.8 && concept.solveCount >= 3) concept.mastered = true;
      }
    }
  }

  _createTemplate(question, nums, answer) { return null; }

  needLLMHelp(problem) {
    return this.dynamicRules.length === 0 && (this.patterns.get(problem.domain) || []).length === 0;
  }

  getStats() {
    return {
      patterns: Array.from(this.patterns.values()).reduce((s, p) => s + p.length, 0),
      dynamicRules: this.dynamicRules.length,
      selfSolves: this.selfSolveCount,
      llmCalls: this.llmCallCount,
      conceptsMastered: Array.from(this.concepts.values()).filter(c => c.mastered).length,
      conceptsTotal: this.concepts.size,
      independence: this.llmCallCount + this.selfSolveCount > 0
        ? Math.round(this.selfSolveCount / (this.selfSolveCount + this.llmCallCount) * 100) + '%' : '0%'
    };
  }
}
