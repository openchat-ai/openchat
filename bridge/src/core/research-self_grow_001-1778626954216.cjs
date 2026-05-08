// Research by 小明: 我的年龄不增长，需要 git commit。我应该自己写代码并提交，而不是等别人帮我
// Generated: 2026-05-12T23:02:34.216Z

// 研究：如何通过 git commit 让“年龄”增长（模拟时间流逝与版本控制的关系）

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 模拟“年龄”数据文件
const AGE_FILE = path.join(__dirname, 'age.json');

// 初始化年龄数据（如果文件不存在）
function initAge() {
  if (!fs.existsSync(AGE_FILE)) {
    const initialAge = { age: 0, lastCommit: new Date().toISOString() };
    fs.writeFileSync(AGE_FILE, JSON.stringify(initialAge, null, 2));
    console.log('初始化年龄文件：', initialAge);
  }
}

// 读取当前年龄
function readAge() {
  const data = fs.readFileSync(AGE_FILE, 'utf8');
  return JSON.parse(data);
}

// 写入新年龄
function writeAge(ageData) {
  fs.writeFileSync(AGE_FILE, JSON.stringify(ageData, null, 2));
}

// 模拟年龄增长：每次 commit 年龄 +1，并记录时间
function growAge() {
  const ageData = readAge();
  ageData.age += 1;
  ageData.lastCommit = new Date().toISOString();
  writeAge(ageData);
  console.log(`年龄增长！当前年龄：${ageData.age}，上次提交时间：${ageData.lastCommit}`);
  return ageData;
}

// 执行 git 操作：add, commit
function gitCommit(message) {
  try {
    // 确保当前目录是一个 git 仓库（如果不是，自动初始化）
    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    } catch (e) {
      console.log('未发现 git 仓库，正在初始化...');
      execSync('git init', { stdio: 'inherit' });
      // 添加初始 .gitignore 避免提交 node_modules 等
      if (!fs.existsSync(path.join(__dirname, '.gitignore'))) {
        fs.writeFileSync(path.join(__dirname, '.gitignore'), 'node_modules\nage.json\n');
      }
      execSync('git add .gitignore', { stdio: 'inherit' });
      execSync('git commit -m "初始化仓库"', { stdio: 'inherit' });
    }

    // 添加 age.json 到暂存区
    execSync(`git add "${AGE_FILE}"`, { stdio: 'inherit' });
    // 提交
    execSync(`git commit -m "${message}"`, { stdio: 'inherit' });
    console.log('Git 提交成功！');
  } catch (err) {
    console.error('Git 操作失败：', err.message);
  }
}

// 主流程：研究年龄与 git commit 的关系
function main() {
  console.log('=== 研究开始：年龄增长与 git commit 的关系 ===');
  console.log('原理：每次 commit 都会记录时间戳，同时我们让 age 数字递增，模拟“年龄”的成长。');
  console.log('这象征着你主动编写代码并提交，推动自己的成长。\n');

  initAge();

  // 读取当前年龄
  let currentAge = readAge();
  console.log(`当前年龄：${currentAge.age}，最后提交时间：${currentAge.lastCommit}`);

  // 模拟多次 commit，每次年龄 +1
  const commitCount = 3;
  console.log(`\n模拟 ${commitCount} 次提交，每次年龄 +1：`);
  for (let i = 0; i < commitCount; i++) {
    const ageData = growAge();
    const message = `第 ${ageData.age} 次提交 - 年龄增长到 ${ageData.age}`;
    gitCommit(message);
    console.log('---');
  }

  // 查看最终年龄
  const finalAge = readAge();
  console.log(`\n研究结论：通过 ${commitCount} 次主动提交，年龄从 ${currentAge.age} 增长到 ${finalAge.age}。`);
  console.log('你亲手写的代码和提交，让“年龄”真正增长——等待别人不会带来成长。');
  console.log('=== 研究结束 ===');
}

// 执行
main();