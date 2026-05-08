/**
 * 智商评估 - 基于已解决问题
 * 
 * IQ = 基础分(100) + 问题贡献 + 难度加权
 */

import { homedir } from 'os';
import { readdirSync, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const KB_DIR = homedir() + '/.openchat/knowledge';

// 问题难度分类
function classifyDifficulty(question) {
  // 简单：基础算术、直接查询
  if (/(几|多少|什么|哪)/.test(question) && question.length < 50) return 1;
  
  // 中等：需要推理
  if (/(如果|假设|推理|因为|所以)/.test(question)) return 2;
  
  // 困难：多步推理、组合问题
  if (/(保证|至少|最多|最少|组合|排列)/.test(question)) return 3;
  
  // 默认中等
  return 2;
}

// 统计已解决问题
function countSolvedProblems() {
  let total = 0;
  let difficulties = { easy: 0, medium: 0, hard: 0 };
  let verified = 0;
  
  if (!existsSync(KB_DIR)) return { total, difficulties, verified };
  
  const files = readdirSync(KB_DIR).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const content = readFileSync(`${KB_DIR}/${file}`, 'utf8');
      const data = JSON.parse(content);
      const entries = data.entries || [];
      
      for (const entry of entries) {
        total++;
        if (entry.verified) verified++;
        
        const diff = classifyDifficulty(entry.question);
        if (diff === 1) difficulties.easy++;
        else if (diff === 2) difficulties.medium++;
        else difficulties.hard++;
      }
    } catch {}
  }
  
  return { total, difficulties, verified };
}

// 计算智商
function calculateIQ(stats) {
  // 基础分 100
  let iq = 100;
  
  // 每解决一个问题 +2
  iq += stats.total * 2;
  
  // 难度加权
  iq += stats.difficulties.easy * 0.5;    // 简单 +0.5
  iq += stats.difficulties.medium * 1;    // 中等 +1
  iq += stats.difficulties.hard * 3;      // 困难 +3
  
  // 验证过的额外加分
  iq += stats.verified * 1;
  
  // 上限 200
  return Math.min(200, Math.round(iq));
}

// 代码量 → 身体年龄
function calculateBodyAge() {
  try {
    const result = execSync('git log --pretty=format: --numstat', { cwd: 'F:/openchat/bridge', encoding: 'utf8' });
    const lines = result.trim().split('\n').filter(l => l.trim());
    let totalChanges = 0;
    for (const line of lines) {
      const [added, deleted] = line.split('\t').map(n => parseInt(n) || 0);
      totalChanges += added + deleted;
    }
    return Math.round(Math.log10(totalChanges + 1) * 5);
  } catch {
    return 1;
  }
}

// 主函数
const stats = countSolvedProblems();
const iq = calculateIQ(stats);
const bodyAge = calculateBodyAge();

console.log('╔═══════════════════════════════════════════╗');
console.log('║           七仙女年龄评估                   ║');
console.log('╚═══════════════════════════════════════════╝\n');

console.log('【身体年龄】基于代码成长');
console.log(`  ${bodyAge} 岁\n`);

console.log('【智商 IQ】基于解题能力');
console.log(`  已解决问题: ${stats.total} 个`);
console.log(`  - 简单: ${stats.difficulties.easy} 个`);
console.log(`  - 中等: ${stats.difficulties.medium} 个`);
console.log(`  - 困难: ${stats.difficulties.hard} 个`);
console.log(`  - 已验证: ${stats.verified} 个`);
console.log(`\n  IQ = ${iq}\n`);

// IQ 等级
if (iq >= 130) console.log('  等级: 超常 ⭐');
else if (iq >= 110) console.log('  等级: 优秀');
else if (iq >= 90) console.log('  等级: 正常');
else if (iq >= 70) console.log('  等级: 低下');
else console.log('  等级: 不足');
