const fs = require('fs');
const path = require('path');
const os = require('os');

const poolDir = path.join(os.homedir(), '.openchat', 'problem-pool');

const problems = [{
  id: 'real_code_001',
  question: '创建文件 F:/openchat/bridge/src/core/hello-resident.js，内容是 module.exports = function() { return Hello from resident; }',
  domain: 'research',
  difficulty: 3,
  answer: null
}];

fs.writeFileSync(path.join(poolDir, 'real-code.json'), JSON.stringify(problems, null, 2));
console.log('已添加需要真实代码实现的问题');
