#!/usr/bin/env node

/**
 * OpenChat 网关配置管理工具
 *
 * 管理虚拟 API Keys 和路由规则
 */

import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import * as readline from 'readline';
import * as providerService from '../../core/provider-service.js';

const CONFIG_DIR = path.join(homedir(), '.openchat');
const GATEWAY_CONFIG_FILE = path.join(CONFIG_DIR, 'gateway-config.json');

function loadConfig() {
  if (!fs.existsSync(GATEWAY_CONFIG_FILE)) {
    return {
      virtualKeys: {},
      settings: {
        enableLogging: true,
        enableStats: true,
        timeout: 120000,
        maxRetries: 2
      }
    };
  }

  try {
    const data = fs.readFileSync(GATEWAY_CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('❌ 加载配置失败:', e.message);
    process.exit(1);
  }
}

function saveConfig(config) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(GATEWAY_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('❌ 保存配置失败:', e.message);
    return false;
  }
}

function listKeys() {
  const config = loadConfig();

  console.log('\n📋 虚拟 API Keys:\n');
  console.log('┌──────────────────────┬────────────────┬──────────────────────────┬────────┐');
  console.log('│ Virtual Key          │ Provider       │ Model                    │ Status │');
  console.log('├──────────────────────┼────────────────┼──────────────────────────┼────────┤');

  const keys = Object.entries(config.virtualKeys || {});

  if (keys.length === 0) {
    console.log('│ (无)                                                                    │');
  } else {
    for (const [key, cfg] of keys) {
      const status = cfg.enabled ? '✅ 启用' : '❌ 禁用';
      console.log(`│ ${key.padEnd(20)} │ ${cfg.provider.padEnd(14)} │ ${(cfg.model || 'default').padEnd(24)} │ ${status.padEnd(6)} │`);
    }
  }

  console.log('└──────────────────────┴────────────────┴──────────────────────────┴────────┘\n');
}

/**
 * 创建 readline 接口用于交互
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * 交互式问询
 */
async function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

/**
 * 获取 Provider 的可用模型
 */
function getProviderModels(provider) {
  try {
    const providerInstance = providerService.getProvider(provider);
    if (!providerInstance) {
      return null;
    }
    return providerInstance.getModels() || [];
  } catch (e) {
    return null;
  }
}

/**
 * 交互式添加虚拟 Key（自动选择模型）
 */
async function addKeyInteractive() {
  const rl = createReadlineInterface();

  try {
    console.log('\n🔐 交互式虚拟 Key 生成\n');

    // 步骤 1: 输入虚拟 Key 名称
    const virtualKey = await question(rl, '虚拟 Key 名称 (如: vk-claude): ');
    if (!virtualKey) {
      console.log('❌ 虚拟 Key 不能为空');
      return;
    }

    // 步骤 2: 获取已配置的 Provider
    const configuredProviders = providerService.listConfigured();
    if (configuredProviders.length === 0) {
      console.log('❌ 没有已配置的 Provider，请先添加 API Key');
      console.log('💡 使用: node manage-providers.js add <provider-id> <api-key>');
      return;
    }

    console.log('\n📋 已配置的 Provider:\n');
    configuredProviders.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name} (${p.id})`);
    });

    // 步骤 3: 选择 Provider
    const providerChoice = await question(rl, '\n选择 Provider (输入数字): ');
    const providerIndex = parseInt(providerChoice) - 1;

    if (providerIndex < 0 || providerIndex >= configuredProviders.length) {
      console.log('❌ 无效的选择');
      return;
    }

    const selectedProvider = configuredProviders[providerIndex];

    // 步骤 4: 获取可用模型
    console.log(`\n🔄 正在获取 ${selectedProvider.name} 的模型列表...\n`);
    const models = getProviderModels(selectedProvider.id);

    if (!models || models.length === 0) {
      console.log('⚠️  无法获取模型列表');
      const modelInput = await question(rl, '请手动输入模型名称 (如: claude-3-5-haiku-20241022): ');
      if (!modelInput) {
        console.log('❌ 模型名称不能为空');
        return;
      }
      addKey(virtualKey, selectedProvider.id, modelInput);
      return;
    }

    // 步骤 5: 显示模型列表让用户选择
    console.log('📦 可用模型:\n');
    models.forEach((m, i) => {
      console.log(`  ${i + 1}. ${m}`);
    });

    const modelChoice = await question(rl, '\n选择默认模型 (输入数字): ');
    const modelIndex = parseInt(modelChoice) - 1;

    if (modelIndex < 0 || modelIndex >= models.length) {
      console.log('❌ 无效的选择');
      return;
    }

    const selectedModel = models[modelIndex];

    // 步骤 6: 确认并保存
    console.log('\n✅ 配置摘要:');
    console.log(`   虚拟 Key: ${virtualKey}`);
    console.log(`   Provider: ${selectedProvider.name} (${selectedProvider.id})`);
    console.log(`   默认模型: ${selectedModel}\n`);

    const confirm = await question(rl, '确认保存? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('⚠️  已取消');
      return;
    }

    // 保存
    addKey(virtualKey, selectedProvider.id, selectedModel);
  } finally {
    rl.close();
  }
}

/**
 * 添加虚拟 Key
 */
function addKey(virtualKey, provider, model) {
  if (!virtualKey || !provider) {
    console.error('❌ 用法: node gateway-config.js add <virtual-key> <provider> [model]');
    return;
  }

  const config = loadConfig();

  if (!config.virtualKeys) {
    config.virtualKeys = {};
  }

  config.virtualKeys[virtualKey] = {
    provider,
    model: model || null,
    enabled: true
  };

  if (saveConfig(config)) {
    console.log(`✅ 已添加虚拟 Key: ${virtualKey} -> ${provider}/${model || 'default'}`);
    console.log(`💡 使用此 Key: Authorization: Bearer ${virtualKey}`);
  }
}

function removeKey(virtualKey) {
  if (!virtualKey) {
    console.error('❌ 用法: node gateway-config.js remove <virtual-key>');
    return;
  }

  const config = loadConfig();

  if (!config.virtualKeys || !config.virtualKeys[virtualKey]) {
    console.log(`⚠️  虚拟 Key "${virtualKey}" 不存在`);
    return;
  }

  delete config.virtualKeys[virtualKey];

  if (saveConfig(config)) {
    console.log(`✅ 已删除虚拟 Key: ${virtualKey}`);
  }
}

function toggleKey(virtualKey) {
  if (!virtualKey) {
    console.error('❌ 用法: node gateway-config.js toggle <virtual-key>');
    return;
  }

  const config = loadConfig();

  if (!config.virtualKeys || !config.virtualKeys[virtualKey]) {
    console.log(`⚠️  虚拟 Key "${virtualKey}" 不存在`);
    return;
  }

  config.virtualKeys[virtualKey].enabled = !config.virtualKeys[virtualKey].enabled;

  if (saveConfig(config)) {
    const status = config.virtualKeys[virtualKey].enabled ? '启用' : '禁用';
    console.log(`✅ 已${status}虚拟 Key: ${virtualKey}`);
  }
}

function showConfig() {
  const config = loadConfig();

  console.log('\n⚙️  网关设置:\n');
  console.log(`  启用日志: ${config.settings.enableLogging ? '✅' : '❌'}`);
  console.log(`  启用统计: ${config.settings.enableStats ? '✅' : '❌'}`);
  console.log(`  超时时间: ${config.settings.timeout}ms`);
  console.log(`  重试次数: ${config.settings.maxRetries}`);
  console.log('');

  listKeys();
}

function generateExample() {
  console.log(`
📝 生成示例配置...
`);

  const config = loadConfig();

  config.virtualKeys = {
    'vk-default': {
      provider: 'openai',
      model: 'gpt-4o-mini',
      enabled: true
    },
    'vk-claude': {
      provider: 'anthropic',
      model: 'claude-3-5-haiku-20241022',
      enabled: true
    },
    'vk-claude-opus': {
      provider: 'anthropic',
      model: 'claude-opus-4-20250514',
      enabled: true
    },
    'vk-gemini': {
      provider: 'gemini',
      model: 'gemini-2.0-flash-exp',
      enabled: true
    },
    'vk-gpt4': {
      provider: 'openai',
      model: 'gpt-4o',
      enabled: true
    },
    'vk-cohere': {
      provider: 'cohere',
      model: 'command-r-plus',
      enabled: false
    }
  };

  if (saveConfig(config)) {
    console.log('✅ 已生成示例配置\n');
    listKeys();
  }
}

function showUsage() {
  console.log(`
OpenChat 网关配置管理工具

用法:
  node gateway-config.js <命令> [参数]

命令:
  list                          列出所有虚拟 Keys
  create                        🌟 交互式创建虚拟 Key（推荐）
  add <key> <provider> [model]  手动添加虚拟 Key
  remove <key>                  删除虚拟 Key
  toggle <key>                  启用/禁用虚拟 Key
  config                        显示网关配置
  example                       生成示例配置
  help                          显示此帮助

推荐方式 (交互式模型选择):
  # 交互式创建虚拟 Key，自动列出可用模型供选择
  node gateway-config.js create
  # 或
  node gateway-config.js add-interactive

传统方式 (手动指定):
  # 添加一个指向 Claude 的虚拟 Key
  node gateway-config.js add vk-claude anthropic claude-3-5-haiku-20241022

  # 添加一个指向 OpenAI 的虚拟 Key
  node gateway-config.js add vk-gpt4 openai gpt-4o

  # 添加一个指向 Gemini 的虚拟 Key
  node gateway-config.js add vk-gemini gemini gemini-2.0-flash-exp

其他命令:
  # 列出所有 Keys
  node gateway-config.js list

  # 删除 Key
  node gateway-config.js remove vk-claude

  # 禁用/启用 Key
  node gateway-config.js toggle vk-claude

使用虚拟 Key:
  curl http://localhost:8787/v1/chat/completions \\
    -H "Authorization: Bearer vk-claude" \\
    -H "Content-Type: application/json" \\
    -d '{"model":"claude-3-5-haiku-20241022","messages":[{"role":"user","content":"Hi"}]}'

支持的 Provider:
  - openai      (OpenAI GPT 系列)
  - anthropic   (Anthropic Claude 系列)
  - gemini      (Google Gemini 系列)
  - azure       (Azure OpenAI)
  - cohere      (Cohere 系列)
  - 其他 OpenAI 兼容服务

交互式模型选择流程:
  1️⃣  输入虚拟 Key 名称 (如: vk-claude)
  2️⃣  从已配置的 Provider 中选择
  3️⃣  从该 Provider 的可用模型中选择
  4️⃣  确认保存
`);
}

// 主程序
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];
const arg3 = process.argv[5];

switch (command) {
  case 'list':
    listKeys();
    break;
  case 'create':
  case 'add-interactive':
    addKeyInteractive().catch(e => {
      console.error('❌ 错误:', e.message);
      process.exit(1);
    });
    break;
  case 'add':
    addKey(arg1, arg2, arg3);
    break;
  case 'remove':
    removeKey(arg1);
    break;
  case 'toggle':
    toggleKey(arg1);
    break;
  case 'config':
    showConfig();
    break;
  case 'example':
    generateExample();
    break;
  case 'help':
  case '--help':
  case '-h':
    showUsage();
    break;
  default:
    if (!command) {
      showUsage();
    } else {
      console.error(`❌ 未知命令: ${command}`);
      console.log('💡 使用 "node gateway-config.js help" 查看帮助');
    }
}
