#!/usr/bin/env node

/**
 * Claude Code Skill 测试
 * 验证质量检查 skill 是否正确部署
 */

import { checkQuality, checkAndCorrect, getDetailedReport } from './quality-check-skill.js';

console.log('🧪 Claude Code Skill 测试\n');
console.log('═'.repeat(60));

// 测试用例
const testCases = [
  {
    name: '简单代码 - 高质量',
    content: `// 计算阶乘
function factorial(n) {
  if (n < 0) throw new Error('负数');
  return n === 0 ? 1 : n * factorial(n - 1);
}`,
    expectPass: true
  },
  {
    name: '代码 - 缺少注释',
    content: `function sort(arr) {
  arr.sort();
  return arr;
}`,
    expectPass: false
  },
  {
    name: '危险代码',
    content: `function runCommand(cmd) {
  eval(cmd);  // 危险!
}`,
    expectPass: false
  },
  {
    name: '普通文本',
    content: '这是一个简单的回答。包含一些解释和说明。',
    expectPass: true
  }
];

async function runTests() {
  for (const testCase of testCases) {
    console.log(`\n📝 ${testCase.name}`);
    console.log('-'.repeat(60));

    try {
      const result = await checkQuality(testCase.content);

      console.log(`质量分: ${result.score}/100`);
      console.log(`状态: ${result.passed ? '✅ 通过' : '❌ 失败'}`);

      if (result.issues.length > 0) {
        console.log(`问题:`);
        result.issues.forEach(issue => {
          console.log(`  - ${issue}`);
        });
      }

      // 验证预期结果
      if (result.passed === testCase.expectPass) {
        console.log(`✅ 测试符合预期`);
      } else {
        console.log(`⚠️  预期 ${testCase.expectPass ? '通过' : '失败'}, 实际 ${result.passed ? '通过' : '失败'}`);
      }
    } catch (error) {
      console.log(`❌ 错误: ${error.message}`);
    }
  }

  // 详细报告示例
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`\n📊 详细报告示例`);
  console.log('-'.repeat(60));

  const report = await getDetailedReport(`// 示例代码
function example() {
  return 42;
}`);

  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  try {
    await runTests();
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ Skill 测试完成！`);
    console.log(`\n现在可以在 Claude Code 中使用：`);
    console.log(`  /qc <content>         - 快速检查`);
    console.log(`  /qc-suggest <content> - 检查并建议`);
    console.log(`  /qc-report <content>  - 详细报告`);
  } catch (error) {
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

main();
