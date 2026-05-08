const fs = require('fs');
let c = fs.readFileSync('F:/openchat/bridge/src/core/resident-scheduler.js', 'utf8');

c = c.replace(
  '    this._maybeCollaborate(residents);\n  }',
  `    this._maybeCollaborate(residents);

    // Self-learning every 10 ticks
    this._learnTick++;
    if (this._learnTick % 10 === 0) {
      this._runSelfLearning();
    }
  }`
);

fs.writeFileSync('F:/openchat/bridge/src/core/resident-scheduler.js', c);
console.log('Done');
