const fs = require('fs');
let content = fs.readFileSync('src/core/resident-decisions.js', 'utf8');

const replacements = [
  ['维护房子', '学习知识'],
  ['紧急修复', '解决问题'],
  ['探索新房子', '探索知识边界'],
  ['备灾准备', '整理知识库'],
  ['house_action', 'learning_action'],
  ['house_unhealthy', 'learning_stuck'],
  ['房子健康', '系统状态'],
];

for (const [old, neu] of replacements) {
  content = content.split(old).join(neu);
}

fs.writeFileSync('src/core/resident-decisions.js', content);
console.log('Updated resident-decisions.js');
