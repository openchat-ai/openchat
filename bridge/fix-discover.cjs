const fs = require('fs');
const content = fs.readFileSync('F:/openchat/bridge/src/core/learning-core.js', 'utf8');

const oldCode = `  _discoverProblem() {
    // 从问题池中找未解决的
    for (const p of this.problemPool) {
      if (this._isSolved(p)) continue;
      return p;
    }
    return null;
  }`;

const newCode = `  _discoverProblem() {
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

const newContent = content.replace(oldCode, newCode);
fs.writeFileSync('F:/openchat/bridge/src/core/learning-core.js', newContent);
console.log('Updated _discoverProblem');
