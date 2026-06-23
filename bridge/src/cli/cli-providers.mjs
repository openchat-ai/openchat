import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const execAsync = promisify(exec);

const KNOWN_TOOLS = [
  { name: 'claude', type: 'claude-code', cmd: 'claude', args: ['--version'] },
  { name: 'opencode', type: 'opencode', cmd: 'opencode', args: ['--version'] },
  { name: 'openx', type: 'openx', cmd: 'openx', args: ['--version'] },
  { name: 'claude-code', type: 'claude-code', cmd: 'claude-code', args: ['--version'] },
  { name: 'open-claude', type: 'open-claude', cmd: 'open-claude', args: ['--version'] },
  { name: 'aider', type: 'aider', cmd: 'aider', args: ['--version'] },
  { name: 'continue', type: 'continue', cmd: 'continue', args: ['--version'] },
  { name: 'devin', type: 'devin', cmd: 'devin', args: ['--version'] },
];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(homedir(), '.openchat');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const PROVIDERS_FILE = path.join(CONFIG_DIR, 'providers.json');

if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

export async function autoDetect() {
  const detected = [];
  for (const tool of KNOWN_TOOLS) {
    try {
      const result = await checkCommand(tool.cmd, tool.args);
      if (result.available) {
        detected.push({ name: tool.name, type: tool.type, command: tool.cmd, detected: result.version, ready: true });
      }
    } catch (e) { console.warn('[cli-providers] detect failed:', e.message); }
  }
  if (detected.length === 0) {
    const additionalTools = await scanNpmGlobal();
    detected.push(...additionalTools);
  }
  return detected;
}

async function checkCommand(cmd, args = []) {
  try {
    const fullCmd = args.length > 0 ? `${cmd} ${args.join(' ')}` : cmd;
    const { stdout, stderr } = await execAsync(fullCmd, { timeout: 5000, windowsHide: true });
    const output = (stdout || stderr || '').trim();
    return { available: true, version: output.split('\n')[0].substring(0, 50) };
  } catch (e) {
    return { available: false, version: null };
  }
}

async function scanNpmGlobal() {
  try {
    const { stdout } = await execAsync('npm list -g --depth=0 2>nul', { timeout: 10000, windowsHide: true });
    const packages = stdout.split('\n');
    const detected = [];
    const aiKeywords = ['claude', 'opencode', 'openx', 'aider', 'continue', 'devin', 'gpt', 'llama', 'ollama'];
    for (const pkg of packages) {
      const name = pkg.replace(/^[├─└│└┬┴┼]/g, '').replace(/@.*$/, '').trim();
      if (name && aiKeywords.some(k => name.toLowerCase().includes(k))) {
        detected.push({ name, type: 'npm-global', command: name, detected: 'npm global package', ready: false });
      }
    }
    return detected;
  } catch (e) {
    return [];
  }
}

export async function checkOllama() {
  try {
    const { stdout } = await execAsync('ollama list', { timeout: 5000, windowsHide: true });
    const models = stdout.split('\n').slice(1).filter(line => line.trim());
    return { available: true, models: models.map(m => m.split(/\s+/)[0]).filter(Boolean) };
  } catch (e) {
    return { available: false, models: [] };
  }
}

export function formatDetectedList(detected) {
  if (detected.length === 0) return '  None';
  return detected.map(t => `  \u2022 ${t.name.padEnd(15)} ${t.detected || ''}`).join('\n');
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { apiKeys: {}, preferences: { currentProvider: null, currentModel: null } };
  }
  try {
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to load config:', e.message);
    return { apiKeys: {}, preferences: { currentProvider: null, currentModel: null } };
  }
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('Failed to save config:', e.message);
    return false;
  }
}

function loadProviders() {
  if (!fs.existsSync(PROVIDERS_FILE)) return {};
  try {
    const data = fs.readFileSync(PROVIDERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    console.error('Failed to load providers:', e.message);
    return {};
  }
}

function listProviders() {
  const config = loadConfig();
  const providers = loadProviders();
  console.debug('\nAvailable AI Providers:\n');
  for (const [id, providerConfig] of Object.entries(providers)) {
    const hasKey = !!config.apiKeys[id];
    const isCurrent = config.preferences.currentProvider === id;
    const name = providerConfig.nameCn || providerConfig.name || id;
    const transport = providerConfig.transport || 'openai_chat';
    const protocol = transport === 'anthropic_messages' ? 'Anthropic' : 'OpenAI';
    const keyStatus = hasKey ? 'configured' : 'no key';
    const prefix = isCurrent ? '=> ' : '   ';
    console.debug(`${prefix}${id}: ${name} (${protocol}) ${keyStatus}`);
  }
  if (config.preferences.currentProvider) {
    console.debug(`\nCurrent: ${config.preferences.currentProvider}${config.preferences.currentModel ? ' / ' + config.preferences.currentModel : ''}`);
  } else {
    console.debug('\nNo default provider set.');
  }
}

function addApiKey(providerId, apiKey) {
  if (!providerId || !apiKey) {
    console.error('Usage: add <provider-id> <api-key>');
    return;
  }
  const config = loadConfig();
  const providers = loadProviders();
  if (!providers[providerId]) {
    console.error(`Provider "${providerId}" not found`);
    return;
  }
  if (!config.apiKeys) config.apiKeys = {};
  config.apiKeys[providerId] = apiKey;
  if (saveConfig(config)) {
    console.debug(`Added API key for ${providerId}`);
  }
}

function removeApiKey(providerId) {
  if (!providerId) { console.error('Usage: remove <provider-id>'); return; }
  const config = loadConfig();
  if (config.apiKeys && config.apiKeys[providerId]) {
    delete config.apiKeys[providerId];
    if (saveConfig(config)) console.debug(`Removed API key for ${providerId}`);
  } else {
    console.debug(`No API key for ${providerId}`);
  }
}

async function testProvider(providerId) {
  if (!providerId) { console.error('Usage: test <provider-id>'); return; }
  const config = loadConfig();
  const providers = loadProviders();
  if (!providers[providerId]) { console.error(`Provider "${providerId}" not found`); return; }
  const apiKey = config.apiKeys[providerId];
  if (!apiKey) { console.error(`No API key for ${providerId}`); return; }
  const providerConfig = providers[providerId];
  const transport = providerConfig.transport || 'openai_chat';
  try {
    if (transport === 'anthropic_messages') {
      await testAnthropicConnection(providerConfig, apiKey);
    } else {
      await testOpenAIConnection(providerConfig, apiKey);
    }
  } catch (e) { console.error(`Connection failed: ${e.message}`); }
}

async function testOpenAIConnection(providerConfig, apiKey) {
  const url = `${providerConfig.baseUrl}${providerConfig.chatEndpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: providerConfig.defaultModel, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }
  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '(no response)';
  console.debug('Connection OK!');
  console.debug(`Model: ${data.model || providerConfig.defaultModel}`);
  console.debug(`Reply: ${reply}`);
}

async function testAnthropicConnection(providerConfig, apiKey) {
  const url = `${providerConfig.baseUrl}/v1/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: providerConfig.defaultModel, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 10 })
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }
  const data = await response.json();
  const reply = data.content?.[0]?.text || '(no response)';
  console.debug('Connection OK!');
  console.debug(`Model: ${data.model || providerConfig.defaultModel}`);
  console.debug(`Reply: ${reply}`);
}

function switchProvider(providerId) {
  if (!providerId) { console.error('Usage: switch <provider-id>'); return; }
  const config = loadConfig();
  const providers = loadProviders();
  if (!providers[providerId]) { console.error(`Provider "${providerId}" not found`); return; }
  if (!config.apiKeys[providerId]) { console.warn(`Warning: no API key for ${providerId}`); }
  if (!config.preferences) config.preferences = {};
  config.preferences.currentProvider = providerId;
  config.preferences.currentModel = providers[providerId].defaultModel;
  if (saveConfig(config)) console.debug(`Switched to ${providerId}`);
}

function showCurrent() {
  const config = loadConfig();
  const providers = loadProviders();
  if (!config.preferences.currentProvider) { console.debug('No default provider set.'); return; }
  const providerId = config.preferences.currentProvider;
  const providerConfig = providers[providerId];
  if (!providerConfig) { console.debug('Current provider config not found.'); return; }
  console.debug(`\nProvider: ${providerConfig.nameCn || providerConfig.name}`);
  console.debug(`ID: ${providerId}`);
  console.debug(`Model: ${config.preferences.currentModel || providerConfig.defaultModel}`);
  console.debug(`API Key: ${config.apiKeys[providerId] ? 'configured' : 'not set'}\n`);
}

function showHelp() {
  console.debug(`
Usage: node cli-providers.mjs <command> [args]

Commands:
  list                        List all providers
  add <id> <api-key>         Add API key
  remove <id>                 Remove API key
  test <id>                   Test connection
  switch <id>                 Set default provider
  current                     Show current config
  help                        Show this help
`);
}

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

switch (command) {
  case 'list': listProviders(); break;
  case 'add': addApiKey(arg1, arg2); break;
  case 'remove': removeApiKey(arg1); break;
  case 'test': testProvider(arg1); break;
  case 'switch': switchProvider(arg1); break;
  case 'current': showCurrent(); break;
  case 'help':
  case '--help':
  case '-h': showHelp(); break;
  default:
    if (!command) { showHelp(); }
    else { console.error(`Unknown command: ${command}`); }
}
