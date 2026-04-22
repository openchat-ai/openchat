#!/usr/bin/env node

/**
 * 配置验证脚本 - 检查系统是否完全就绪
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const env = {};
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    content.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) env[key.trim()] = value.trim();
    });
  } catch (e) {
    // 没有.env文件
  }
  return env;
}

const ENV = loadEnv();

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                    ✅ OpenChat 系统配置验证                                 ║
║                        完整性检查和就绪状态                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

// 检查项
const checks = {
  '认证令牌': ENV.ANTHROPIC_AUTH_TOKEN || ENV.ANTHROPIC_API_KEY,
  'API 基础 URL': ENV.ANTHROPIC_BASE_URL || ENV.LLM_API_BASE,
  '主模型配置': ENV.ANTHROPIC_MODEL || ENV.LLM_MODEL,
  'Haiku 模型': ENV.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  'Sonnet 模型': ENV.ANTHROPIC_DEFAULT_SONNET_MODEL,
  'Opus 模型': ENV.ANTHROPIC_DEFAULT_OPUS_MODEL,
  'API 超时设置': ENV.API_TIMEOUT_MS,
  '流量控制设置': ENV.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC !== undefined
};

let allPassed = true;
const results = [];

console.log('【配置检查清单】\n');

for (const [name, value] of Object.entries(checks)) {
  const passed = !!value;
  allPassed = allPassed && passed;
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${name}: ${passed ? '已配置' : '未配置'}`);
  results.push({ name, passed, value });
}

console.log(`\n【详细信息】\n`);

console.log(`认证方式:`);
console.log(`  • ANTHROPIC_AUTH_TOKEN: ${ENV.ANTHROPIC_AUTH_TOKEN ? '✅ 已设置' : '❌ 未设置'}`);
console.log(`  • ANTHROPIC_API_KEY: ${ENV.ANTHROPIC_API_KEY ? '✅ 已设置' : '❌ 未设置'}`);

console.log(`\nAPI 配置:`);
console.log(`  • URL: ${ENV.ANTHROPIC_BASE_URL || ENV.LLM_API_BASE || '❌ 未设置'}`);
console.log(`  • 超时: ${ENV.API_TIMEOUT_MS || '❌ 未设置'} ms`);

console.log(`\n模型配置:`);
console.log(`  • 默认: ${ENV.ANTHROPIC_MODEL || ENV.LLM_MODEL || '❌ 未设置'}`);
console.log(`  • Haiku: ${ENV.ANTHROPIC_DEFAULT_HAIKU_MODEL || '❌ 未设置'}`);
console.log(`  • Sonnet: ${ENV.ANTHROPIC_DEFAULT_SONNET_MODEL || '❌ 未设置'}`);
console.log(`  • Opus: ${ENV.ANTHROPIC_DEFAULT_OPUS_MODEL || '❌ 未设置'}`);

console.log(`\n可用脚本:`);

const scripts = [
  { file: 'real-agent-runner.js', desc: '核心运行器 - 执行自动开发' },
  { file: 'start-with-full-config.js', desc: '配置状态 - 显示完整配置' },
  { file: 'model-selection-guide.js', desc: '模型指南 - 模型对比和选择' },
  { file: 'setup-local-llm.js', desc: '配置向导 - 交互式配置' },
  { file: '8-minute-detailed-analysis.js', desc: '分析工具 - 分析执行结果' }
];

for (const script of scripts) {
  const exists = fs.existsSync(path.join(__dirname, script.file));
  const status = exists ? '✅' : '❌';
  console.log(`${status} ${script.file.padEnd(30)} - ${script.desc}`);
}

console.log(`\n【系统就绪状态】\n`);

if (allPassed) {
  console.log(`✨ ✨ ✨ 系统完全就绪！✨ ✨ ✨\n`);
  console.log(`你可以立即运行以下命令启动自动开发系统：\n`);

  console.log(`【推荐命令】\n`);
  console.log(`1️⃣  快速测试 (Haiku - 最便宜，~$0.02):`);
  console.log(`   $ node real-agent-runner.js --haiku\n`);

  console.log(`2️⃣  通用运行 (Sonnet - 推荐，~$0.10):`);
  console.log(`   $ node real-agent-runner.js --sonnet\n`);

  console.log(`3️⃣  默认运行 (Haiku):`);
  console.log(`   $ node real-agent-runner.js\n`);

  console.log(`4️⃣  8 分钟观察 (Sonnet):`);
  console.log(`   $ node real-agent-runner.js --sonnet --monitor 8m\n`);

  console.log(`5️⃣  演示模式 (无需 API):`);
  console.log(`   $ node real-agent-runner.js --simulate\n`);

  console.log(`【支持的所有参数】\n`);
  console.log(`模型选择:`);
  console.log(`  --haiku        使用 Claude Haiku 4.5 (最快最便宜)`);
  console.log(`  --sonnet       使用 Claude Sonnet 4.5 (推荐)`);
  console.log(`  --opus         使用 Claude Opus 4.6 (最强)`);
  console.log(`\n其他参数:`);
  console.log(`  --simulate     演示模式（不调用真实 API）`);
  console.log(`  --monitor 8m   8 分钟长期观察模式\n`);

} else {
  console.log(`⚠️  系统配置不完整\n`);
  console.log(`缺失的配置项:`);

  for (const result of results) {
    if (!result.passed) {
      console.log(`  • ${result.name}`);
    }
  }

  console.log(`\n请运行配置向导:`);
  console.log(`  $ node setup-local-llm.js\n`);
}

console.log(`═══════════════════════════════════════════════════════════════════════════════\n`);
