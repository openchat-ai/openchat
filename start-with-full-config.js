#!/usr/bin/env node

/**
 * Claude模型连接验证和启动脚本 - 完整配置版
 * 支持 .claude.json 中的所有环境变量
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 读取配置
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
║          🚀 Claude 模型配置已激活 - OpenChat真实运行（完整配置）          ║
║                   使用完整的 .claude.json 环境变量配置                      ║
╚══════════════════════════════════════════════════════════════════════════════╝

【完整配置信息】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

认证方式: ANTHROPIC_AUTH_TOKEN ✅
API基础URL: ${ENV.ANTHROPIC_BASE_URL || 'https://xy.dzzi.ai'}
主模型: ${ENV.ANTHROPIC_MODEL || '[未配置]'}
超时设置: ${ENV.API_TIMEOUT_MS || '600000'}ms (${parseInt(ENV.API_TIMEOUT_MS || '600000') / 1000}秒)

【可用模型配置】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

模型选择优先级（环境变量优先）:

  1️⃣  默认 (使用 ANTHROPIC_MODEL)
  2️⃣  Haiku (使用 ANTHROPIC_DEFAULT_HAIKU_MODEL)
  3️⃣  Sonnet (使用 ANTHROPIC_DEFAULT_SONNET_MODEL)
  4️⃣  Opus (使用 ANTHROPIC_DEFAULT_OPUS_MODEL)

当前配置:
  • ANTHROPIC_MODEL: ${ENV.ANTHROPIC_MODEL}
  • ANTHROPIC_SMALL_FAST_MODEL: ${ENV.ANTHROPIC_SMALL_FAST_MODEL}
  • ANTHROPIC_DEFAULT_HAIKU_MODEL: ${ENV.ANTHROPIC_DEFAULT_HAIKU_MODEL}
  • ANTHROPIC_DEFAULT_SONNET_MODEL: ${ENV.ANTHROPIC_DEFAULT_SONNET_MODEL}
  • ANTHROPIC_DEFAULT_OPUS_MODEL: ${ENV.ANTHROPIC_DEFAULT_OPUS_MODEL}

【其他配置参数】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: ${ENV.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC || '未设置'}
API_TIMEOUT_MS: ${ENV.API_TIMEOUT_MS || '600000'}ms

【启动命令】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

# 基础运行（使用 ANTHROPIC_MODEL）
node real-agent-runner.js

# 使用 Haiku 模型运行 (最快最便宜)
node real-agent-runner.js --haiku

# 使用 Sonnet 模型运行 (通用)
node real-agent-runner.js --sonnet

# 使用 Opus 模型运行 (最强推理)
node real-agent-runner.js --opus

# 演示模式（无需 API 调用）
node real-agent-runner.js --simulate

# 查看当前配置
cat .env

【系统检查】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

// 验证配置
const hasAuth = !!(ENV.ANTHROPIC_AUTH_TOKEN || ENV.ANTHROPIC_API_KEY);
const hasUrl = !!(ENV.ANTHROPIC_BASE_URL || ENV.LLM_API_BASE);
const hasModel = !!(ENV.ANTHROPIC_MODEL || ENV.LLM_MODEL);

console.log(`✅ 认证配置: ${hasAuth ? '已设置' : '❌ 未设置'}`);
console.log(`✅ API URL: ${hasUrl ? '已设置' : '❌ 未设置'}`);
console.log(`✅ 模型配置: ${hasModel ? '已设置' : '❌ 未设置'}`);

if (hasAuth && hasUrl && hasModel) {
  console.log(`\n✨ 配置完整，系统已就绪！\n`);
} else {
  console.log(`\n⚠️  配置不完整，请运行:\n  node setup-local-llm.js\n`);
}

console.log(`【成本估算】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

根据模型的定价（可能已过期）:

Claude Haiku-4.5:
  • 输入: $0.80 / 百万 tokens
  • 输出: $4.00 / 百万 tokens
  • 单次运行: ~$0.01-0.05
  • 8分钟观察: ~$0.05-0.20

Claude Sonnet-4.5:
  • 输入: $3.00 / 百万 tokens
  • 输出: $15.00 / 百万 tokens
  • 单次运行: ~$0.05-0.15
  • 8分钟观察: ~$0.20-0.50

Claude Opus-4.6:
  • 输入: $15.00 / 百万 tokens
  • 输出: $75.00 / 百万 tokens
  • 单次运行: ~$0.10-0.30
  • 8分钟观察: ~$0.50-1.50

【立即启动】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

使用默认模型（推荐快速体验）:

  node real-agent-runner.js

使用 Sonnet 获得更好的质量:

  node real-agent-runner.js --sonnet

8分钟长期观察（观察系统学习能力）:

  node real-agent-runner.js --monitor 8m

✨ 准备好了吗？现在就启动吧！
`);
