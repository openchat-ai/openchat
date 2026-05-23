#!/usr/bin/env node

/**
 * OpenChat Provider 管理工具
 *
 * 用于管理 OpenAI 和 Anthropic 等多个 AI 服务商的配置和 API Keys
 *
 * 使用方法:
 *   node manage-providers.js list                      # 列出所有服务商
 *   node manage-providers.js add openai <api-key>      # 添加 OpenAI API Key
 *   node manage-providers.js add anthropic <api-key>   # 添加 Anthropic API Key
 *   node manage-providers.js test openai               # 测试 OpenAI 连接
 *   node manage-providers.js test anthropic            # 测试 Anthropic 连接
 *   node manage-providers.js current                   # 显示当前使用的服务商
 *   node manage-providers.js switch anthropic          # 切换到 Anthropic
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 配置文件路径
const CONFIG_DIR = path.join(homedir(), '.openchat');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PROVIDERS_FILE = path.join(CONFIG_DIR, 'providers.json');

// 确保配置目录存在
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

/**
 * 加载配置
 */
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return {
      apiKeys: {},
      preferences: {
        currentProvider: null,
        currentModel: null
      }
    };
  }

  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('❌ 加载配置失败:', e.message);
    return {
      apiKeys: {},
      preferences: {
        currentProvider: null,
        currentModel: null
      }
    };
  }
}

/**
 * 保存配置
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('❌ 保存配置失败:', e.message);
    return false;
  }
}

/**
 * 加载服务商配置
 */
function loadProviders() {
  if (!fs.existsSync(PROVIDERS_FILE)) {
    return {};
  }

  try {
    const data = fs.readFileSync(PROVIDERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('❌ 加载服务商配置失败:', e.message);
    return {};
  }
}

/**
 * 列出所有服务商
 */
function listProviders() {
  const config = loadConfig();
  const providers = loadProviders();

  console.log('\n📋 可用的 AI 服务商:\n');
  console.log('┌─────────────────┬──────────────────────┬─────────────┬──────────────┐');
  console.log('│ ID              │ 名称                 │ 协议        │ API Key 状态 │');
  console.log('├─────────────────┼──────────────────────┼─────────────┼──────────────┤');

  for (const [id, providerConfig] of Object.entries(providers)) {
    const hasKey = !!config.apiKeys[id];
    const isCurrent = config.preferences.currentProvider === id;
    const name = providerConfig.nameCn || providerConfig.name || id;
    const transport = providerConfig.transport || 'openai_chat';
    const protocol = transport === 'anthropic_messages' ? 'Anthropic' : 'OpenAI';
    const keyStatus = hasKey ? '✅ 已配置' : '❌ 未配置';
    const prefix = isCurrent ? '👉 ' : '   ';

    console.log(`│ ${prefix}${id.padEnd(13)} │ ${name.padEnd(20)} │ ${protocol.padEnd(11)} │ ${keyStatus.padEnd(12)} │`);
  }

  console.log('└─────────────────┴──────────────────────┴─────────────┴──────────────┘\n');

  if (config.preferences.currentProvider) {
    console.log(`✨ 当前使用: ${config.preferences.currentProvider}`);
    if (config.preferences.currentModel) {
      console.log(`📦 当前模型: ${config.preferences.currentModel}`);
    }
  } else {
    console.log('⚠️  尚未设置默认服务商，请使用: node manage-providers.js switch <provider-id>');
  }
  console.log('');
}

/**
 * 添加 API Key
 */
function addApiKey(providerId, apiKey) {
  if (!providerId || !apiKey) {
    console.error('❌ 用法: node manage-providers.js add <provider-id> <api-key>');
    return;
  }

  const config = loadConfig();
  const providers = loadProviders();

  // 检查服务商是否存在
  if (!providers[providerId]) {
    console.error(`❌ 服务商 "${providerId}" 不存在`);
    console.log('💡 使用 "node manage-providers.js list" 查看可用服务商');
    return;
  }

  // 保存 API Key
  if (!config.apiKeys) {
    config.apiKeys = {};
  }
  config.apiKeys[providerId] = apiKey;

  if (saveConfig(config)) {
    console.log(`✅ 已添加 ${providerId} 的 API Key`);
    console.log(`💡 使用 "node manage-providers.js test ${providerId}" 测试连接`);
  }
}

/**
 * 删除 API Key
 */
function removeApiKey(providerId) {
  if (!providerId) {
    console.error('❌ 用法: node manage-providers.js remove <provider-id>');
    return;
  }

  const config = loadConfig();

  if (config.apiKeys && config.apiKeys[providerId]) {
    delete config.apiKeys[providerId];

    if (saveConfig(config)) {
      console.log(`✅ 已删除 ${providerId} 的 API Key`);
    }
  } else {
    console.log(`⚠️  ${providerId} 没有配置 API Key`);
  }
}

/**
 * 测试连接
 */
async function testProvider(providerId) {
  if (!providerId) {
    console.error('❌ 用法: node manage-providers.js test <provider-id>');
    return;
  }

  const config = loadConfig();
  const providers = loadProviders();

  if (!providers[providerId]) {
    console.error(`❌ 服务商 "${providerId}" 不存在`);
    return;
  }

  const apiKey = config.apiKeys[providerId];
  if (!apiKey) {
    console.error(`❌ 未配置 ${providerId} 的 API Key`);
    console.log(`💡 使用 "node manage-providers.js add ${providerId} <api-key>" 添加`);
    return;
  }

  console.log(`\n🔄 正在测试 ${providerId} 连接...\n`);

  const providerConfig = providers[providerId];
  const transport = providerConfig.transport || 'openai_chat';

  try {
    if (transport === 'anthropic_messages') {
      await testAnthropicConnection(providerConfig, apiKey);
    } else {
      await testOpenAIConnection(providerConfig, apiKey);
    }
  } catch (e) {
    console.error(`❌ 连接失败: ${e.message}`);
  }
}

/**
 * 测试 OpenAI 协议连接
 */
async function testOpenAIConnection(providerConfig, apiKey) {
  const url = `${providerConfig.baseUrl}${providerConfig.chatEndpoint}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: providerConfig.defaultModel,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 10
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '(无响应)';

  console.log('✅ 连接成功!');
  console.log(`📦 模型: ${data.model || providerConfig.defaultModel}`);
  console.log(`💬 测试响应: ${reply}`);
  console.log('');
}

/**
 * 测试 Anthropic 协议连接
 */
async function testAnthropicConnection(providerConfig, apiKey) {
  const url = `${providerConfig.baseUrl}/v1/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: providerConfig.defaultModel,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 10
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const reply = data.content?.[0]?.text || '(无响应)';

  console.log('✅ 连接成功!');
  console.log(`📦 模型: ${data.model || providerConfig.defaultModel}`);
  console.log(`💬 测试响应: ${reply}`);
  console.log('');
}

/**
 * 切换默认服务商
 */
function switchProvider(providerId) {
  if (!providerId) {
    console.error('❌ 用法: node manage-providers.js switch <provider-id>');
    return;
  }

  const config = loadConfig();
  const providers = loadProviders();

  if (!providers[providerId]) {
    console.error(`❌ 服务商 "${providerId}" 不存在`);
    return;
  }

  if (!config.apiKeys[providerId]) {
    console.error(`⚠️  警告: ${providerId} 尚未配置 API Key`);
    console.log(`💡 使用 "node manage-providers.js add ${providerId} <api-key>" 添加`);
  }

  if (!config.preferences) {
    config.preferences = {};
  }

  config.preferences.currentProvider = providerId;
  config.preferences.currentModel = providers[providerId].defaultModel;

  if (saveConfig(config)) {
    console.log(`✅ 已切换到 ${providerId}`);
    console.log(`📦 默认模型: ${config.preferences.currentModel}`);
  }
}

/**
 * 显示当前配置
 */
function showCurrent() {
  const config = loadConfig();
  const providers = loadProviders();

  if (!config.preferences.currentProvider) {
    console.log('⚠️  尚未设置默认服务商');
    return;
  }

  const providerId = config.preferences.currentProvider;
  const providerConfig = providers[providerId];

  if (!providerConfig) {
    console.log('❌ 当前服务商配置不存在');
    return;
  }

  console.log('\n📌 当前配置:\n');
  console.log(`  服务商: ${providerConfig.nameCn || providerConfig.name}`);
  console.log(`  ID: ${providerId}`);
  console.log(`  协议: ${providerConfig.transport === 'anthropic_messages' ? 'Anthropic' : 'OpenAI'}`);
  console.log(`  模型: ${config.preferences.currentModel || providerConfig.defaultModel}`);
  console.log(`  API Key: ${config.apiKeys[providerId] ? '✅ 已配置' : '❌ 未配置'}`);
  console.log('');
}

/**
 * 显示帮助
 */
function showHelp() {
  console.log(`
OpenChat Provider 管理工具

用法:
  node manage-providers.js <命令> [参数]

命令:
  list                          列出所有服务商
  add <id> <api-key>           添加服务商的 API Key
  remove <id>                   删除服务商的 API Key
  test <id>                     测试服务商连接
  switch <id>                   切换默认服务商
  current                       显示当前配置
  help                          显示此帮助信息

示例:
  # 添加 OpenAI API Key
  node manage-providers.js add openai sk-xxx...

  # 添加 Anthropic API Key
  node manage-providers.js add anthropic sk-ant-xxx...

  # 测试 Anthropic 连接
  node manage-providers.js test anthropic

  # 切换到 Anthropic
  node manage-providers.js switch anthropic

  # 查看当前配置
  node manage-providers.js current

支持的服务商:
  - openai      (OpenAI GPT 系列)
  - anthropic   (Anthropic Claude 系列)
  - sub2api     (Sub2API 聚合服务)
  - 更多...     (使用 list 命令查看)
`);
}

// 主程序
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

switch (command) {
  case 'list':
    listProviders();
    break;
  case 'add':
    addApiKey(arg1, arg2);
    break;
  case 'remove':
    removeApiKey(arg1);
    break;
  case 'test':
    testProvider(arg1);
    break;
  case 'switch':
    switchProvider(arg1);
    break;
  case 'current':
    showCurrent();
    break;
  case 'help':
  case '--help':
  case '-h':
    showHelp();
    break;
  default:
    if (!command) {
      showHelp();
    } else {
      console.error(`❌ 未知命令: ${command}`);
      console.log('💡 使用 "node manage-providers.js help" 查看帮助');
    }
}
