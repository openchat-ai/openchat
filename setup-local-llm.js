#!/usr/bin/env node

/**
 * OpenChat 本地集成配置脚本
 * 快速配置 Ollama 或 API Key
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '.env');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║           ⚙️  OpenChat 本地LLM集成配置脚本                                 ║
║                快速设置 Ollama 或 API Key                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  console.log(`\n请选择配置方式:\n`);
  console.log(`1️⃣  使用 Ollama (本地模型，推荐)`);
  console.log(`2️⃣  使用 API Key (DeepSeek/OpenAI等)`);
  console.log(`3️⃣  混合模式 (优先本地，失败用API)`);
  console.log(`4️⃣  演示模式 (无需配置)`);
  console.log(`5️⃣  跳过 (保持现有配置)\n`);

  const choice = await question('请输入你的选择 (1-5): ');

  let config = {};

  if (choice === '1') {
    // Ollama配置
    console.log(`\n【Ollama 配置】\n`);
    console.log(`确保已安装并运行Ollama: https://ollama.ai/download\n`);

    const host = await question('Ollama服务器地址 (默认: http://localhost:11434): ') ||
                 'http://localhost:11434';
    const model = await question('模型名称 (默认: deepseek-coder:1.3b): ') ||
                  'deepseek-coder:1.3b';

    config = {
      USE_OLLAMA: 'true',
      OLLAMA_API_BASE: host,
      OLLAMA_MODEL: model
    };

    console.log(`\n📝 Ollama 配置已准备:`);
    console.log(`   • 服务器: ${host}`);
    console.log(`   • 模型: ${model}\n`);
    console.log(`💡 如果还未拉取模型，请运行:`);
    console.log(`   ollama pull ${model}\n`);

  } else if (choice === '2') {
    // API配置
    console.log(`\n【API Key 配置】\n`);
    console.log(`选择你的LLM提供商:\n`);
    console.log(`1. DeepSeek (https://platform.deepseek.com/)`);
    console.log(`2. OpenAI (https://platform.openai.com/)`);
    console.log(`3. Anthropic Claude (https://xy.dzzi.ai)\n`);

    const provider = await question('选择提供商 (1-3): ');
    let apiKey, baseUrl, model;

    if (provider === '1') {
      apiKey = await question('请输入 DeepSeek API Key: ');
      baseUrl = 'https://api.deepseek.com/v1';
      model = 'deepseek-chat';
      config = {
        LLM_API_BASE: baseUrl,
        DEEPSEEK_API_KEY: apiKey,
        LLM_MODEL: model
      };
    } else if (provider === '2') {
      apiKey = await question('请输入 OpenAI API Key: ');
      baseUrl = 'https://api.openai.com/v1';
      model = 'gpt-4o-mini';
      config = {
        LLM_API_BASE: baseUrl,
        OPENAI_API_KEY: apiKey,
        LLM_MODEL: model
      };
    } else if (provider === '3') {
      apiKey = await question('请输入 Claude API Key: ');
      baseUrl = 'https://xy.dzzi.ai';
      model = 'claude-opus-4.1';
      config = {
        LLM_API_BASE: baseUrl,
        ANTHROPIC_API_KEY: apiKey,
        LLM_MODEL: model
      };
    }

    console.log(`\n📝 API 配置已准备:`);
    console.log(`   • 提供商: ${['DeepSeek', 'OpenAI', 'Claude'][parseInt(provider) - 1]}`);
    console.log(`   • API Key: ${apiKey.substring(0, 10)}...`);
    console.log(`   • 模型: ${model}\n`);

  } else if (choice === '3') {
    // 混合模式
    console.log(`\n【混合模式配置】\n`);

    const host = await question('Ollama服务器地址 (默认: http://localhost:11434): ') ||
                 'http://localhost:11434';
    const model = await question('Ollama模型 (默认: deepseek-coder:1.3b): ') ||
                  'deepseek-coder:1.3b';
    const apiKey = await question('备用 API Key (可选): ') || '';

    config = {
      USE_OLLAMA: 'true',
      FALLBACK_API: 'true',
      OLLAMA_API_BASE: host,
      OLLAMA_MODEL: model
    };

    if (apiKey) {
      config.DEEPSEEK_API_KEY = apiKey;
    }

    console.log(`\n📝 混合模式配置已准备:`);
    console.log(`   • 优先: Ollama (${model})`);
    console.log(`   • 备用: ${apiKey ? 'API Key' : '无'}\n`);

  } else if (choice === '4') {
    // 演示模式
    console.log(`\n【演示模式】\n`);
    console.log(`✅ 演示模式已就绪，无需配置`);
    console.log(`   • 真实系统架构`);
    console.log(`   • 真实执行流程`);
    console.log(`   • 模拟的LLM输出\n`);
    console.log(`运行命令:`);
    console.log(`   node real-agent-runner.js --simulate\n`);

    rl.close();
    process.exit(0);

  } else if (choice === '5') {
    console.log(`\n✅ 配置已跳过\n`);
    rl.close();
    process.exit(0);
  } else {
    console.log(`❌ 无效选择\n`);
    rl.close();
    process.exit(1);
  }

  // 保存配置
  if (Object.keys(config).length > 0) {
    const envContent = Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n';

    try {
      fs.writeFileSync(envPath, envContent);
      console.log(`✅ 配置已保存到 .env\n`);
      console.log(`【配置内容】\n`);
      Object.entries(config).forEach(([key, value]) => {
        const displayValue = value.length > 30 ? value.substring(0, 20) + '...' : value;
        console.log(`   ${key}=${displayValue}`);
      });
    } catch (e) {
      console.error(`❌ 配置保存失败: ${e.message}\n`);
      rl.close();
      process.exit(1);
    }

    // 下一步提示
    console.log(`\n【下一步】\n`);
    if (choice === '1') {
      console.log(`1. 确保 Ollama 服务已运行:`);
      console.log(`   ollama serve\n`);
      console.log(`2. 运行 OpenChat 代理:`);
      console.log(`   node real-agent-runner.js\n`);
    } else if (choice === '2') {
      console.log(`运行 OpenChat 代理:`);
      console.log(`   node real-agent-runner.js\n`);
    } else if (choice === '3') {
      console.log(`1. 启动 Ollama (可选):`);
      console.log(`   ollama serve\n`);
      console.log(`2. 运行 OpenChat 代理:`);
      console.log(`   node real-agent-runner.js\n`);
    }

    console.log(`💡 查看帮助:`);
    console.log(`   node real-agent-runner.js --help\n`);

    console.log(`📊 运行演示模式 (无需LLM):`);
    console.log(`   node real-agent-runner.js --simulate\n`);
  }

  rl.close();
}

main().catch(console.error);
