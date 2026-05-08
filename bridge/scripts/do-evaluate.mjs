/**
 * 立即评估智商年龄（自然统计 - 基于代码修改量）
 */
import { homedir } from 'os';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const { persistentConfig } = await import('../src/core/persistent-config.js');

// 自然统计：Git 代码修改量（增行 + 删行）
let totalChanges = 0;
let commitCount = 0;
try {
  // 统计总修改行数
  const result = execSync('git log --pretty=format: --numstat', { cwd: 'F:/openchat/bridge', encoding: 'utf8' });
  const lines = result.trim().split('\n').filter(l => l.trim());
  for (const line of lines) {
    const [added, deleted] = line.split('\t').map(n => parseInt(n) || 0);
    totalChanges += added + deleted;
  }
  
  // 提交次数
  const countResult = execSync('git rev-list --count HEAD', { cwd: 'F:/openchat/bridge', encoding: 'utf8' });
  commitCount = parseInt(countResult.trim()) || 0;
} catch {
  totalChanges = 0;
  commitCount = 0;
}

// 收集指标
const uptimeDays = process.uptime() / 86400;
const healthScore = 85;

// 知识库条目数
let kbSize = 0;
try {
  const kbDir = homedir() + '/.openchat/knowledge';
  const fs = await import('fs');
  const files = fs.readdirSync(kbDir).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const content = fs.readFileSync(kbDir + '/' + f, 'utf8');
    const data = JSON.parse(content);
    kbSize += Object.keys(data).length;
  }
} catch {
  kbSize = 0;
}

const residentCount = 1;

// 计算智商年龄
// 基础 = 代码修改量的对数（防止无限增长）
let mentalAge = Math.log10(totalChanges + 1) * 5; // 每10倍修改量 +5岁
mentalAge += Math.sqrt(commitCount) * 0.5; // 提交次数小贡献
mentalAge += uptimeDays * 0.1;
mentalAge += Math.floor(kbSize / 50) * 0.5;
mentalAge += residentCount * 0.2;
mentalAge -= Math.floor((100 - healthScore) / 10) * 0.3;
mentalAge = Math.max(1, Math.round(mentalAge * 10) / 10);

console.log('╔═══════════════════════════════════════════╗');
console.log('║       智商年龄评估（代码修改量）           ║');
console.log('╚═══════════════════════════════════════════╝\n');

console.log(`代码修改量: ${totalChanges.toLocaleString()} 行`);
console.log(`Git 提交次数: ${commitCount} 次`);
console.log(`运行时间: ${uptimeDays.toFixed(1)} 天`);
console.log(`知识库: ${kbSize} 条`);
console.log(`居民: ${residentCount} 个`);
console.log(`健康分: ${healthScore}`);
console.log(`\n智商年龄: ${mentalAge} 岁`);
