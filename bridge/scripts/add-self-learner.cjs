const fs = require('fs');
let c = fs.readFileSync('F:/openchat/bridge/src/core/resident-scheduler.js', 'utf8');

// 1. Add import
c = c.replace(
  "import { decideActions } from './resident-decisions.js';",
  "import { decideActions } from './resident-decisions.js';\nimport { SelfLearner } from './self-learner.js';"
);

// 2. Add properties
c = c.replace(
  'this._lastAction = new Map();',
  'this._lastAction = new Map();\n\n    this._selfLearner = null;\n    this._learnTick = 0;'
);

// 3. Add method before final }
const method = `

  _runSelfLearning() {
    if (!this._selfLearner) {
      this._selfLearner = new SelfLearner({ scheduler: this });
    }
    this._selfLearner.runLearningRound().catch(e => console.log('[self-learn]', e.message));
  }
`;

const lastBrace = c.lastIndexOf('\n}');
if (lastBrace > 0) {
  c = c.slice(0, lastBrace) + method + c.slice(lastBrace);
}

fs.writeFileSync('F:/openchat/bridge/src/core/resident-scheduler.js', c);
console.log('Done. Has SelfLearner:', c.includes('SelfLearner'));
console.log('Has _selfLearner:', c.includes('_selfLearner'));
console.log('Has _runSelfLearning:', c.includes('_runSelfLearning'));
