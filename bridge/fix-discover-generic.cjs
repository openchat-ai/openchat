const fs = require('fs');
const content = fs.readFileSync('F:/openchat/bridge/src/core/learning-core.js', 'utf8');

const oldCode = `  // ==================== 问题发现 ====================

  _discoverProblem() {
    // 优先选择有预设答案的问题
    for (const p of this.problemPool) {
      if (this._isSolved(p)) continue;
      if (p.answer !== null && p.answer !== undefined) return p;
    }
    // 再处理无预设答案的
    for (const p of this.problemPool) {
      if (this._isSolved(p)) continue;
      return p;
    }
    return null;
  }`;

const newCode = `  // ==================== 问题发现 ====================

  _discoverProblem() {
    const unsolved = this.problemPool.filter(p => !this._isSolved(p));
    if (unsolved.length === 0) return null;
    
    // 通用策略：轮换不同领域，保证每种类型都有机会
    const byDomain = {};
    unsolved.forEach(p => {
      const domain = p.domain || 'general';
      if (!byDomain[domain]) byDomain[domain] = [];
      byDomain[domain].push(p);
    });
    
    const domains = Object.keys(byDomain);
    if (domains.length === 0) return null;
    
    // 轮换：基于当前轮次选择不同领域
    const round = this.solvedCount || 0;
    const selectedDomain = domains[round % domains.length];
    const candidates = byDomain[selectedDomain];
    
    // 在该领域内，优先选难度低的
    candidates.sort((a, b) => (a.difficulty || 2) - (b.difficulty || 2));
    return candidates[0];
  }`;

const newContent = content.replace(oldCode, newCode);
fs.writeFileSync('F:/openchat/bridge/src/core/learning-core.js', newContent);
console.log('Updated _discoverProblem - generic domain rotation');
