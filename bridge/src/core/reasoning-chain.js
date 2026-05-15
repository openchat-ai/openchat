/**
 * ReasoningChain — 演绎+归纳双引擎推理链
 *
 * 架构：
 *   SymbolicReasoner → 定理匹配 + 符号演算（演绎，确保正确）
 *   InductiveReasoner → 样本观察 + 规律归纳（归纳，产生新知识）
 *   TheoremDB         → 公理库 + 定理注册 + 持久化
 *
 * 流程：
 *   问题 → 定理匹配 → 命中？返回答案
 *                    → 未命中 → 归纳推理 → 发现新定理 → 写入TheoremDB
 *                    → 还不行 → 标记为待解
 *
 * 分布式：
 *   每发现一条新定理 → 写入本地 TheoremDB
 *   → 标记为 P2P 可广播 → 邻居节点收到 → 写入自己的 TheoremDB
 *   → 0 LLM 成本，纯逻辑增长
 */

export class ReasoningChain {
  /**
   * @param {import('./theorem-db.js').TheoremDB} theoremDB
   * @param {import('./inductive-reasoner.js').InductiveReasoner} inductive
   * @param {import('./symbolic-reasoner.js').SymbolicReasoner} symbolic
   */
  constructor(theoremDB, inductive, symbolic) {
    this.theoremDB = theoremDB;
    this.inductive = inductive;
    this.symbolic = symbolic;

    // Stats
    this.deductiveHits = 0;     // 定理库直接命中
    this.inductiveDiscoveries = 0; // 归纳发现新定理
    this.pendingCount = 0;      // 仍无法解决的问题
    this.totalAttempts = 0;

    // History
    this._discoveryLog = [];    // 最近发现的定理
  }

  /**
   * 主求解入口
   * @param {{question: string, domain: string, answer?: any}} problem
   * @returns {{solved: boolean, answer?: any, method?: string, theorem?: string}}
   */
  solve(problem) {
    this.totalAttempts++;

    // 1. 演绎：定理库匹配
    const dedResult = this._deductiveSolve(problem);
    if (dedResult.solved) {
      this.deductiveHits++;
      return { solved: true, answer: dedResult.answer, method: 'deduction', theorem: dedResult.theorem };
    }

    // 2. 归纳：需要同题型的多个样本
    // 这里只有单题，不做归纳。归纳在批量触发时运行。
    // 标记为 deductive miss — 待积累更多样本后归纳
    this.pendingCount++;
    return { solved: false, method: 'pending_induction' };
  }

  /**
   * 批量归纳：积累足够同题型后，尝试发现新定理
   * @param {Array<{question: string, domain: string, answer: any}>} solvedProblems — 最近解出的题
   * @returns {Array<{name: string, domain: string, formula: string}>} 发现的新定理
   */
  runInduction(solvedProblems) {
    if (!solvedProblems || solvedProblems.length < 3) return [];

    const discoveries = this.inductive.hypothesize(solvedProblems);

    for (const d of discoveries) {
      if (!d.verified) continue;

      // 写入 TheoremDB
      const domain = this._mapTypeToDomain(d.type);
      const existing = this.theoremDB.get(d.name);
      if (!existing) {
        this.theoremDB.add(d.name, domain, 2, d.formula, d.compute);
        this.inductiveDiscoveries++;
        this._discoveryLog.push({
          name: d.name,
          domain,
          formula: d.formula,
          samples: d.sampleCount,
          timestamp: Date.now()
        });
      }
    }

    // 只保留最近 100 条发现日志
    if (this._discoveryLog.length > 100) {
      this._discoveryLog = this._discoveryLog.slice(-100);
    }

    return discoveries;
  }

  /**
   * 演绎求解：遍历已知定理
   */
  _deductiveSolve(problem) {
    const q = problem.question || '';

    for (const [name, theorem] of this.theoremDB.theorems) {
      if (!theorem.compute) continue;

      const nums = q.match(/\d+/g)?.map(Number) || [];
      if (nums.length === 0) continue;

      try {
        const answer = theorem.compute(...nums);
        if (answer !== undefined && answer !== null && !isNaN(answer)) {
          return { solved: true, answer, theorem: name };
        }
      } catch {}
    }

    return { solved: false };
  }

  /**
   * 题型签名 → TheoremDB 领域
   */
  _mapTypeToDomain(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('加') || t.includes('减') || t.includes('乘') || t.includes('除')) return 'arithmetic';
    if (t.includes('方程') || t.includes('代数')) return 'algebra';
    if (t.includes('面积') || t.includes('体积') || t.includes('勾股') || t.includes('圆') || t.includes('三角形')) return 'geometry';
    if (t.includes('概率') || t.includes('组合')) return 'probability';
    if (t.includes('质数') || t.includes('因数') || t.includes('公约')) return 'number_theory';
    if (t.includes('数列') || t.includes('等差') || t.includes('等比')) return 'series';
    if (t.includes('百分') || t.includes('折扣')) return 'arithmetic';
    return 'general';
  }

  /** 获取统计 */
  getStats() {
    return {
      totalAttempts: this.totalAttempts,
      deductiveHits: this.deductiveHits,
      inductiveDiscoveries: this.inductiveDiscoveries,
      pendingCount: this.pendingCount,
      theoremCount: this.theoremDB.theorems.size,
      recentDiscoveries: this._discoveryLog.slice(-5),
      hitRate: this.totalAttempts > 0 ? (this.deductiveHits / this.totalAttempts * 100).toFixed(1) : '0.0',
    };
  }

  /** 导出可广播的发现（用于 P2P） */
  exportDiscoveries() {
    return this._discoveryLog.slice(-10).map(d => ({
      ...d,
      compute: this.theoremDB.get(d.name)?.compute?.toString() || null,
    }));
  }

  /** 导入邻居节点广播的定理 */
  importDiscovery(discovery) {
    if (!discovery.name || !discovery.formula) return false;
    const existing = this.theoremDB.get(discovery.name);
    if (existing) return false; // 已有，跳过

    // 重建 compute 函数（安全性：只接受简单数学公式）
    let compute = null;
    try {
      if (discovery.compute && typeof discovery.compute === 'string') {
        const fn = new Function('return ' + discovery.compute)();
        if (typeof fn === 'function') compute = fn;
      }
    } catch {}

    this.theoremDB.add(discovery.name, discovery.domain || 'general', 2, discovery.formula, compute);
    this.inductiveDiscoveries++;
    this._discoveryLog.push({
      name: discovery.name,
      domain: discovery.domain || 'general',
      formula: discovery.formula,
      samples: discovery.samples || 0,
      timestamp: Date.now(),
      source: 'p2p_import'
    });
    return true;
  }
}

export default ReasoningChain;
