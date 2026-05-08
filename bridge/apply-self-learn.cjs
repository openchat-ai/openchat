const fs = require('fs');
let c = fs.readFileSync('F:/openchat/bridge/src/core/resident-scheduler.js', 'utf8');

// Add SelfLearner import
if (!c.includes("import { SelfLearner }")) {
  c = c.replace(
    "import { decideActions } from './resident-decisions.js';",
    "import { decideActions } from './resident-decisions.js';\nimport { SelfLearner } from './self-learner.js';"
  );
}

// Add properties
if (!c.includes('this._selfLearner')) {
  c = c.replace(
    'this._lastAction = new Map();     // residentId',
    'this._lastAction = new Map();\n\n    this._selfLearner = null;\n    this._learnTick = 0;\n\n    // residentId'
  );
}

// Add _runSelfLearning call in _tick
if (!c.includes('this._runSelfLearning()')) {
  c = c.replace(
    '    this._maybeCollaborate(residents);\n  }',
    '    this._maybeCollaborate(residents);\n\n    // Self-learning every 10 ticks\n    this._learnTick++;\n    if (this._learnTick % 10 === 0) {\n      this._runSelfLearning();\n    }\n  }'
  );
}

// Add _runSelfLearning method
if (!c.includes('_runSelfLearning()')) {
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
}

fs.writeFileSync('F:/openchat/bridge/src/core/resident-scheduler.js', c);
console.log('Done. Checking...');
console.log('Has SelfLearner import:', c.includes("import { SelfLearner }"));
console.log('Has _selfLearner:', c.includes('this._selfLearner'));
console.log('Has _runSelfLearning:', c.includes('_runSelfLearning()'));
