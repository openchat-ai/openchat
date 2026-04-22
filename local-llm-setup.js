#!/usr/bin/env node

/**
 * 本地LLM集成方案 - OpenChat真实系统测试
 * 支持多种本地模型方式
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║         🚀 本地LLM集成方案 - OpenChat真实系统激活                           ║
║                    选择你的本地模型运行方式                                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

const options = {
  1: {
    name: '🦙 Ollama (推荐)',
    desc: '最简单，一键启动本地LLM',
    install: 'https://ollama.ai/download',
    setup: `
步骤1: 下载并安装 Ollama
  → https://ollama.ai/download (Windows版本)

步骤2: 启动Ollama服务
  → ollama serve

步骤3: 拉取模型 (在另一个终端)
  → ollama pull deepseek-coder:1.3b  (推荐，轻量)
  或 → ollama pull neural-chat      (通用模型)
  或 → ollama pull mistral          (高质量)

步骤4: 验证
  → curl http://localhost:11434/api/tags

步骤5: 运行OpenChat
  → USE_OLLAMA=true node real-agent-runner.js
    `
  },
  2: {
    name: '🏃 LLM API 代理 (快速)',
    desc: '无需本地模型，使用在线API但缓存本地',
    install: '无需安装',
    setup: `
步骤1: 获取API Key (任选一个)
  → DeepSeek: https://platform.deepseek.com/
  → OpenAI: https://platform.openai.com/
  → Claude: https://console.anthropic.com/

步骤2: 创建.env文件
  DEEPSEEK_API_KEY=your_key_here
  或 OPENAI_API_KEY=your_key_here

步骤3: 运行OpenChat
  → node real-agent-runner.js
    `
  },
  3: {
    name: '🧪 混合模式 (最强)',
    desc: '优先Ollama本地，失败自动降级到API',
    install: '推荐先装Ollama',
    setup: `
步骤1: 安装Ollama (同方案1)

步骤2: 准备API Key作为备用
  DEEPSEEK_API_KEY=your_backup_key

步骤3: 运行OpenChat
  → USE_OLLAMA=true FALLBACK_API=true node real-agent-runner.js
  系统会自动选择最优方式
    `
  },
  4: {
    name: '📊 监控模拟器 (演示)',
    desc: '真实的监控，模拟的LLM（理解流程)',
    install: '无需安装',
    setup: `
步骤1: 直接运行
  → node real-agent-runner.js --simulate

这会显示：
  ✅ 真实的系统架构
  ✅ 真实的执行流程
  ✅ 真实的监控数据
  (但LLM输出是模拟的)
    `
  }
};

console.log(`\n【推荐方案】\n`);
for (const [key, opt] of Object.entries(options)) {
  console.log(`${key}. ${opt.name}`);
  console.log(`   📝 ${opt.desc}\n`);
}

console.log(`

选择方案: 查看下面的详细说明

`);

// 方案1: Ollama
console.log(`\n${'═'.repeat(80)}`);
console.log(`方案 1️⃣  ${options[1].name}`);
console.log(`${'═'.repeat(80)}\n`);
console.log(options[1].setup);

// 方案2: API
console.log(`\n${'═'.repeat(80)}`);
console.log(`方案 2️⃣  ${options[2].name}`);
console.log(`${'═'.repeat(80)}\n`);
console.log(options[2].setup);

// 方案3: 混合
console.log(`\n${'═'.repeat(80)}`);
console.log(`方案 3️⃣  ${options[3].name}`);
console.log(`${'═'.repeat(80)}\n`);
console.log(options[3].setup);

// 方案4: 模拟
console.log(`\n${'═'.repeat(80)}`);
console.log(`方案 4️⃣  ${options[4].name}`);
console.log(`${'═'.repeat(80)}\n`);
console.log(options[4].setup);

// 帮助信息
console.log(`\n${'═'.repeat(80)}`);
console.log(`🛠️  快速启动命令`);
console.log(`${'═'.repeat(80)}\n`);

console.log(`# 方案1: Ollama (必须先装Ollama)`);
console.log(`ollama serve                    # 终端1: 启动Ollama服务`);
console.log(`ollama pull deepseek-coder    # 终端2: 拉取模型`);
console.log(`USE_OLLAMA=true node real-agent-runner.js  # 终端3: 运行OpenChat\n`);

console.log(`# 方案2: 用API Key`);
console.log(`echo "DEEPSEEK_API_KEY=sk-xxx" > .env`);
console.log(`node real-agent-runner.js\n`);

console.log(`# 方案4: 只看演示（无需任何配置）`);
console.log(`node real-agent-runner.js --simulate\n`);

// 系统信息
console.log(`\n${'═'.repeat(80)}`);
console.log(`💻 当前系统信息`);
console.log(`${'═'.repeat(80)}\n`);

console.log(`操作系统: Windows`);
console.log(`Node.js: ${process.version}`);
console.log(`当前目录: ${process.cwd()}\n`);

// 检查环境
console.log(`【环境检查】\n`);

// 检查是否有.env
try {
  const envPath = path.join(__dirname, '.env');
  await fs.access(envPath);
  console.log(`✅ 已找到 .env 文件`);
} catch {
  console.log(`❌ 未找到 .env 文件 (需要则创建)`);
}

// 检查bridge目录
try {
  const bridgePath = path.join(__dirname, 'bridge');
  await fs.access(bridgePath);
  console.log(`✅ 已找到 bridge 目录`);
} catch {
  console.log(`❌ 未找到 bridge 目录`);
}

console.log(`\n${'═'.repeat(80)}`);
console.log(`📋 推荐流程`);
console.log(`${'═'.repeat(80)}\n`);

console.log(`
0️⃣  现在就能运行 (无需任何安装):
    node real-agent-runner.js --simulate
    这会展示完整的系统监控和执行流程

1️⃣  想要真实的LLM输出? 选择:
    • 最简单: 安装Ollama，运行本地模型
    • 最快速: 用你的API Key (ChatGPT/DeepSeek等)
    • 最全能: 两个都装，系统自动选择

2️⃣  然后运行真实的8分钟观察:
    node real-agent-runner.js --monitor 8m

3️⃣  观察真实的系统学习过程!
`);

console.log(`\n${'═'.repeat(80)}`);
console.log(`✨ 下一步: 运行 real-agent-runner.js`);
console.log(`${'═'.repeat(80)}\n`);

console.log(`立即开始: node real-agent-runner.js --help\n`);
