import { readFileSync, writeFileSync } from 'fs';

const file = 'F:/openchat/bridge/src/core/resident-scheduler.js';
let content = readFileSync(file, 'utf8');

// 1. Add SelfLearner import (already done, skip)

// 2. Add self-learner properties to constructor
content = content.replace(
  'this._lastAction = new Map();',
  `this._lastAction = new Map();

    this._selfLearner = null;
    this._learnTick = 0;`
);

// 3. Add _runSelfLearning method before the last closing brace
const runSelfLearningMethod = `

  /**
   * 自学习 — 发现问题并提交求解
   */
  _runSelfLearning() {
    if (!this._selfLearner) {
      this._selfLearner = new SelfLearner({ scheduler: this });
    }
    
    this._selfLearner.runLearningRound().catch(e => {
      console.log('[自学] 学习失败:', e.message);
    });
  }
`;

// Insert before the final closing brace of the class
const lastBrace = content.lastIndexOf('\n}');
if (lastBrace > 0) {
  content = content.slice(0, lastBrace) + runSelfLearningMethod + content.slice(lastBrace);
}

writeFileSync(file, content);
console.log('Done');
