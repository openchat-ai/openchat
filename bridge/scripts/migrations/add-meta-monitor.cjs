const fs = require('fs');
const content = fs.readFileSync('F:/openchat/bridge/src/core/learning-core.js', 'utf8');

// 1. 在构造函数中添加历史记录
const oldConstructor = `class LearningCore {
  constructor(kb, p2p) {
    this.kb = kb;
    this.p2p = p2p;
    this.problemPool = [];
    this.solvedCount = 0;
    this.iq = 100;
    this.age = 0;
    
    this._initDirs();
    this._loadProblemPool();
    this._loadStats();
  }`;

const newConstructor = `class LearningCore {
  constructor(kb, p2p) {
    this.kb = kb;
    this.p2p = p2p;
    this.problemPool = [];
    this.solvedCount = 0;
    this.iq = 100;
    this.age = 0;
    
    // 元监控：记录历史状态
    this.history = {
      lastIq: 100,
      lastAge: 0,
      lastSolved: 0,
      lastCheck: Date.now(),
      warnings: []
    };
    
    this._initDirs();
    this._loadProblemPool();
    this._loadStats();
  }`;

// 2. 在 runCycle 开头添加元检查
const oldRunCycle = `  async runCycle() {
    // 1. 发现问题`;
const newRunCycle = `  async runCycle() {
    // 0. 元监控检查
    this._metaCheck();
    
    // 1. 发现问题`;

let newContent = content.replace(oldConstructor, newConstructor);
newContent = newContent.replace(oldRunCycle, newRunCycle);

// 3. 在 getReport 后添加元监控方法
const oldGetReportEnd = `  getReport() {
    const stats = this.getStats();
    return \`
╔═══════════════════════════════════╗
║        学习核心 - 状态报告         ║
╠═══════════════════════════════════╣
║  智商(IQ): \${stats.iq.toString().padEnd(20)}║
║  年龄:     \${stats.age.toString().padEnd(20)}║
║  已解决:   \${stats.solvedCount.toString().padEnd(20)}║
║  待解决:   \${stats.pendingProblems.toString().padEnd(20)}║
╚═══════════════════════════════════╝
    \`.trim();
  }
}

export { LearningCore };`;

const newGetReportEnd = `  getReport() {
    const stats = this.getStats();
    const warnings = this.history.warnings.length > 0 ? \`\\n║  警告:     \${this.history.warnings.length}条              ║\` : '';
    return \`
╔═══════════════════════════════════╗
║        学习核心 - 状态报告         ║
╠═══════════════════════════════════╣
║  智商(IQ): \${stats.iq.toString().padEnd(20)}║
║  年龄:     \${stats.age.toString().padEnd(20)}║
║  已解决:   \${stats.solvedCount.toString().padEnd(20)}║
║  待解决:   \${stats.pendingProblems.toString().padEnd(20)}║\${warnings}
╚═══════════════════════════════════╝
    \`.trim();
  }

  // ==================== 元监控 ====================

  _metaCheck() {
    const now = Date.now();
    const elapsed = (now - this.history.lastCheck) / 1000; // 秒
    
    // 每60秒检查一次
    if (elapsed < 60) return;
    
    const issues = [];
    
    // 检查1：年龄是否增长
    if (this.age === this.history.lastAge && this.age > 0) {
      issues.push({ type: 'age_stuck', message: '年龄长时间未增长', value: this.age });
    }
    
    // 检查2：IQ是否增长（有待解决问题时）
    const pending = this.problemPool.filter(p => !this._isSolved(p)).length;
    if (pending > 0 && this.iq === this.history.lastIq && elapsed > 120) {
      issues.push({ type: 'iq_stuck', message: '有未解决问题但IQ未增长', value: this.iq });
    }
    
    // 检查3：解决问题数是否增长
    if (pending > 0 && this.solvedCount === this.history.lastSolved && elapsed > 120) {
      issues.push({ type: 'solving_stuck', message: '问题池有题但无法解决', pending });
    }
    
    // 记录问题
    if (issues.length > 0) {
      this.history.warnings = issues;
      console.log('[元监控] 发现异常:', issues.map(i => i.message).join(', '));
    } else {
      this.history.warnings = [];
    }
    
    // 更新历史
    this.history.lastIq = this.iq;
    this.history.lastAge = this.age;
    this.history.lastSolved = this.solvedCount;
    this.history.lastCheck = now;
  }
}

export { LearningCore };`;

newContent = newContent.replace(oldGetReportEnd, newGetReportEnd);

fs.writeFileSync('F:/openchat/bridge/src/core/learning-core.js', newContent);
console.log('Added meta monitoring to LearningCore');
