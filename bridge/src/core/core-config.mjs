import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { DEFAULT_PORT } from '../constants.js';

const USER_DIR = process.env.OPENCHAT_HOME || path.join(os.homedir(), '.openchat');
const CONFIG_FILE = process.env.OPENCHAT_CONFIG || path.join(USER_DIR, 'config.json');
const NEW_CONFIG_FILE = path.join(os.homedir(), '.config', 'openchat', 'config.json');
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const PROJECT_DIR = path.join(PROJECT_ROOT, '.openchat');
const SESSIONS_DIR = path.join(PROJECT_DIR, 'sessions');
const SKILLS_DIR = path.join(PROJECT_DIR, 'skills');
const MEMORY_DIR = path.join(PROJECT_DIR, 'memory');
const LOGS_DIR = path.join(PROJECT_DIR, 'logs');
const HOUSES_DIR = path.join(USER_DIR, 'houses');

const DEFAULT_CONFIG = {
  providers: {},
  current: { provider: null, model: null },
  bridge: {
    mode: 'headless', host: 'localhost', port: DEFAULT_PORT, name: '', region: '', age: 0,
    dhtPort: 0, localBootstrap: [], directListen: 0, directConnect: [], topic: 'openchat-community',
    wsSignaling: '', advertiseHost: '', qiniuEnabled: true, cores: [], hostId: '',
    deployServerEnabled: true, deployServerPort: 8080, llmDailyTokenBudget: 1000000,
    llmCacheEnabled: true, residentThinkMinInterval: 5
  }
};

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function readJson(file, defaultValue) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  return defaultValue;
}

function writeJson(file, data) { ensureDir(path.dirname(file)); fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

class PersistentConfig {
  constructor() {
    ensureDir(USER_DIR); ensureDir(PROJECT_DIR); ensureDir(SESSIONS_DIR);
    ensureDir(SKILLS_DIR); ensureDir(MEMORY_DIR); ensureDir(LOGS_DIR); ensureDir(HOUSES_DIR);
    const newCfg = readJson(NEW_CONFIG_FILE, null);
    const oldCfg = readJson(CONFIG_FILE, null);
    this.config = newCfg || oldCfg || DEFAULT_CONFIG;
    if (oldCfg) {
      if (oldCfg.bridge && !this.config.bridge) this.config.bridge = oldCfg.bridge;
      if (oldCfg.sessionHistory) this.config.sessionHistory = oldCfg.sessionHistory;
    }
  }

  getProvider(name) { return this.config.providers?.[name] || null; }

  setProvider(name, cfg) {
    if (!this.config.providers) this.config.providers = {};
    this.config.providers[name] = cfg; this.save();
  }

  listProviders() { return Object.keys(this.config.providers || {}); }

  getEnabledProviders() {
    const providers = this.config.providers || {};
    return Object.entries(providers).filter(([_, cfg]) => cfg.enabled && cfg.apiKey).map(([name, cfg]) => ({ name, ...cfg }));
  }

  getApiKey(provider) {
    const p = this.config.providers?.[provider];
    if (p?.apiKey || p?.options?.apiKey) return p.apiKey || p.options.apiKey;
    const nc = loadNewConfig();
    const np = nc?.providers?.[provider];
    return np?.apiKey || np?.options?.apiKey || null;
  }

  setApiKey(provider, key) {
    if (!this.config.providers) this.config.providers = {};
    if (!this.config.providers[provider]) this.config.providers[provider] = {};
    this.config.providers[provider].apiKey = key; this.save();
  }

  getCurrentProvider() {
    if (this.config.current?.provider) return this.config.current.provider;
    const nc = loadNewConfig(); return nc?.current?.provider || null;
  }

  getCurrentModel() {
    if (this.config.current?.model) return this.config.current.model;
    const nc = loadNewConfig(); return nc?.current?.model || null;
  }

  setCurrentProvider(name) {
    if (!this.config.current) this.config.current = {};
    this.config.current.provider = name; this.save();
  }

  setCurrentModel(model) {
    if (!this.config.current) this.config.current = {};
    this.config.current.model = model; this.save();
  }

  resolveModelName(providerName, model) {
    if (!model || !providerName) return null;
    const providerCfg = this.getProvider(providerName);
    const models = providerCfg?.models;
    if (!models) return null;
    if (models[model]) return model;
    for (const [key, val] of Object.entries(models)) {
      if (val.name === model || val.displayName === model) return key;
    }
    return null;
  }

  addSessionToHistory(sessionId, providerType, model) {
    if (!this.config.sessionHistory) this.config.sessionHistory = [];
    this.config.sessionHistory.push({ sessionId, providerType, model, createdAt: Date.now() });
    this.save();
  }

  getBridgeConfig() { this.ensureHostId(); return { ...DEFAULT_CONFIG.bridge, ...(this.config.bridge || {}) }; }

  setBridgeConfig(cfg) {
    const oldHostId = this.config.bridge?.hostId || '';
    this.config.bridge = { ...DEFAULT_CONFIG.bridge, ...this.config.bridge, ...cfg };
    if (oldHostId) this.config.bridge.hostId = oldHostId;
    this.save();
  }

  ensureHostId() {
    if (!this.config.bridge) this.config.bridge = {};
    if (!this.config.bridge.hostId) { this.config.bridge.hostId = randomUUID(); this.save(); }
    return this.config.bridge.hostId;
  }

  getHostId() { return this.ensureHostId(); }

  incrementAge() {
    if (!this.config.bridge) this.config.bridge = {};
    this.config.bridge.age = (this.config.bridge.age || 0) + 1;
    this.save(); return this.config.bridge.age;
  }

  getAge() { return this.config.bridge?.age || 0; }

  setMentalAge(age) {
    if (!this.config.bridge) this.config.bridge = {};
    this.config.bridge.mentalAge = age; this.config.bridge.mentalAgeEvaluatedAt = Date.now();
    this.save();
  }

  getMentalAge() { return this.config.bridge?.mentalAge || 0; }

  getMemory(topic) {
    const file = path.join(MEMORY_DIR, `${topic}.md`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  setMemory(topic, content) { fs.writeFileSync(path.join(MEMORY_DIR, `${topic}.md`), content); }

  listMemory() {
    if (!fs.existsSync(MEMORY_DIR)) return [];
    return fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
  }

  getSkillDir() { return SKILLS_DIR; }

  getPreference(key, defaultValue = null) {
    if (key === 'currentProvider') return this.getCurrentProvider() || defaultValue;
    if (key === 'currentModel') return this.getCurrentModel() || defaultValue;
    return this.config.preferences?.[key] ?? defaultValue;
  }

  setPreference(key, value) {
    if (key === 'currentProvider') return this.setCurrentProvider(value);
    if (key === 'currentModel') return this.setCurrentModel(value);
    if (!this.config.preferences) this.config.preferences = {};
    this.config.preferences[key] = value; this.save();
  }

  save() {
    const errs = validateConfig(this.config);
    if (errs.length > 0) { console.warn(`[config] validation failed (${errs.length}): ${errs.join('; ')}`); return; }
    const sensitive = {};
    if (this.config.current) sensitive.current = this.config.current;
    if (this.config.providers) sensitive.providers = this.config.providers;
    writeJson(NEW_CONFIG_FILE, sensitive);
    const nonsensitive = {};
    if (this.config.bridge) nonsensitive.bridge = this.config.bridge;
    if (this.config.sessionHistory) nonsensitive.sessionHistory = this.config.sessionHistory;
    if (this.config.preferences) nonsensitive.preferences = this.config.preferences;
    writeJson(CONFIG_FILE, nonsensitive);
  }

  getPaths() {
    return { configFile: CONFIG_FILE, projectDir: PROJECT_DIR, sessionsDir: SESSIONS_DIR, skillsDir: SKILLS_DIR, memoryDir: MEMORY_DIR, logsDir: LOGS_DIR, housesDir: HOUSES_DIR };
  }
}

function loadNewConfig() {
  try { if (fs.existsSync(NEW_CONFIG_FILE)) return JSON.parse(fs.readFileSync(NEW_CONFIG_FILE, 'utf8')); } catch (e) { console.error('[C0]', e); }
  return null;
}

export function validateConfig(cfg) {
  const errors = [];
  if (cfg.providers && (typeof cfg.providers !== 'object' || Array.isArray(cfg.providers))) errors.push('providers: must be object');
  if (cfg.current) {
    if (cfg.current.provider != null && typeof cfg.current.provider !== 'string') errors.push('current.provider: must be string or null');
    if (cfg.current.model != null && typeof cfg.current.model !== 'string') errors.push('current.model: must be string or null');
  }
  if (cfg.bridge) {
    const b = cfg.bridge;
    if (b.mode && !['headless', 'gui', 'server'].includes(b.mode)) errors.push('bridge.mode: must be headless/gui/server');
    if (b.port != null && (typeof b.port !== 'number' || b.port < 1024 || b.port > 65535)) errors.push('bridge.port: must be 1024-65535');
    if (b.host != null && typeof b.host !== 'string') errors.push('bridge.host: must be string');
    if (b.name != null && (typeof b.name !== 'string' || b.name.length > 100)) errors.push('bridge.name: must be string <=100 chars');
    if (b.age != null && (typeof b.age !== 'number' || b.age < 0)) errors.push('bridge.age: must be >=0');
    if (b.dhtPort != null && (typeof b.dhtPort !== 'number' || b.dhtPort < 0)) errors.push('bridge.dhtPort: must be >=0');
    if (b.localBootstrap != null && !Array.isArray(b.localBootstrap)) errors.push('bridge.localBootstrap: must be array');
    if (b.directListen != null && (typeof b.directListen !== 'number' || b.directListen < 0)) errors.push('bridge.directListen: must be >=0');
    if (b.directConnect != null && !Array.isArray(b.directConnect)) errors.push('bridge.directConnect: must be array');
    if (b.topic != null && typeof b.topic !== 'string') errors.push('bridge.topic: must be string');
    if (b.wsSignaling != null && (typeof b.wsSignaling !== 'string' || (b.wsSignaling && !b.wsSignaling.startsWith('ws')))) errors.push('bridge.wsSignaling: must start with ws(s)://');
    if (b.advertiseHost != null && typeof b.advertiseHost !== 'string') errors.push('bridge.advertiseHost: must be string');
    if (b.qiniuEnabled != null && typeof b.qiniuEnabled !== 'boolean') errors.push('bridge.qiniuEnabled: must be boolean');
    if (b.cores != null && !Array.isArray(b.cores)) errors.push('bridge.cores: must be array');
    if (b.hostId != null && typeof b.hostId !== 'string') errors.push('bridge.hostId: must be string');
    if (b.deployServerEnabled != null && typeof b.deployServerEnabled !== 'boolean') errors.push('bridge.deployServerEnabled: must be boolean');
    if (b.deployServerPort != null && (typeof b.deployServerPort !== 'number' || b.deployServerPort < 1024 || b.deployServerPort > 65535)) errors.push('bridge.deployServerPort: must be 1024-65535');
    if (b.llmDailyTokenBudget != null && (typeof b.llmDailyTokenBudget !== 'number' || b.llmDailyTokenBudget < 0)) errors.push('bridge.llmDailyTokenBudget: must be >=0');
    if (b.llmCacheEnabled != null && typeof b.llmCacheEnabled !== 'boolean') errors.push('bridge.llmCacheEnabled: must be boolean');
    if (b.residentThinkMinInterval != null && (typeof b.residentThinkMinInterval !== 'number' || b.residentThinkMinInterval < 1)) errors.push('bridge.residentThinkMinInterval: must be >=1');
  }
  return errors;
}

export class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.skills = new Map();
  }

  async registerPlugin(plugin) {
    this.plugins.set(plugin.id, plugin);
    if (plugin.tools) for (const tool of plugin.tools) this.registerTool(tool);
  }

  registerTool(tool) {
    this.skills.set(tool.name, { ...tool, level: 2, registeredAt: Date.now(), paramSchema: tool.params || {} });
  }

  getTools(level = 0) {
    return Array.from(this.skills.values()).map(tool => {
      if (level === 0) return { name: tool.name };
      if (level === 1) return { name: tool.name, description: tool.description };
      return tool;
    });
  }

  validateArgs(toolName, args) {
    const tool = this.skills.get(toolName);
    if (!tool) return { valid: false, error: `Tool ${toolName} not found` };
    const schema = tool.paramSchema;
    if (!schema || Object.keys(schema).length === 0) return { valid: true };
    if (args == null) {
      const missing = Object.entries(schema).filter(([, def]) => def.required).map(([name]) => name);
      if (missing.length > 0) return { valid: false, error: `Missing required parameters: ${missing.join(', ')}` };
      return { valid: true };
    }
    for (const [paramName, paramDef] of Object.entries(schema)) {
      if (paramDef.required && !(paramName in args)) {
        return { valid: false, error: `Missing required parameter: ${paramName}`, suggestion: `Provide ${paramName} parameter` };
      }
    }
    const normalizedArgs = { ...args };
    if (toolName === 'run_command' || toolName === 'shell_exec') {
      if (!normalizedArgs.command && normalizedArgs.cmd) normalizedArgs.command = normalizedArgs.cmd;
      if (!normalizedArgs.command && normalizedArgs.shell) normalizedArgs.command = normalizedArgs.shell;
      if (!normalizedArgs.command && normalizedArgs.message) normalizedArgs.command = normalizedArgs.message;
    }
    if (toolName === 'git_commit') {
      if (!normalizedArgs.message && normalizedArgs.msg) normalizedArgs.message = normalizedArgs.msg;
      if (!normalizedArgs.message && normalizedArgs.commitMessage) normalizedArgs.message = normalizedArgs.commitMessage;
    }
    return { valid: true, normalizedArgs };
  }

  async executeTool(name, args, context) {
    const tool = this.skills.get(name);
    if (!tool) throw new Error(`Tool ${name} not found. Available: ${Array.from(this.skills.keys()).join(', ')}`);
    const validation = this.validateArgs(name, args);
    if (!validation.valid) {
      console.debug(`[PluginManager] Invalid args for ${name}: ${validation.error}`);
      return { success: false, error: validation.error, suggestion: validation.suggestion, tool: name, providedArgs: args };
    }
    const normalizedArgs = validation.normalizedArgs || args;
    console.debug(`[PluginManager] Executing tool ${name} with args:`, normalizedArgs);
    try {
      return await tool.execute(normalizedArgs, context);
    } catch (error) {
      console.error(`[PluginManager] Tool ${name} error:`, error.message);
      return { success: false, error: error.message, tool: name, providedArgs: normalizedArgs, stack: error.stack };
    }
  }

  getToolsForFunctionCalling(toolNames = null) {
    const tools = toolNames ? toolNames.map(name => this.skills.get(name)).filter(Boolean) : Array.from(this.skills.values());
    return tools.map(tool => ({
      type: 'function',
      function: { name: tool.name, description: tool.description || `Execute ${tool.name}`, parameters: this.convertParamsToSchema(tool.paramSchema || {}) }
    }));
  }

  convertParamsToSchema(params) {
    const properties = {};
    const required = [];
    for (const [name, def] of Object.entries(params)) {
      properties[name] = { type: def.type || 'string', description: def.description || '' };
      if (def.required !== false) required.push(name);
    }
    return { type: 'object', properties, required: required.length > 0 ? required : undefined };
  }

  formatToolResult(toolName, result) {
    switch (toolName) {
      case 'run_command': return this.formatCommandResult(result);
      case 'read_file': return this.formatFileReadResult(result);
      case 'write_file': return this.formatFileWriteResult(result);
      case 'git_status': return this.formatGitStatusResult(result);
      case 'git_diff': return this.formatGitDiffResult(result);
      default: return this.formatGenericResult(toolName, result);
    }
  }

  formatCommandResult(result) {
    if (result.success) {
      const output = result.output || '(no output)';
      const truncated = output.length > 2000 ? output.substring(0, 2000) + '\n... (truncated)' : output;
      return `[Command executed]\n\`\`\`\n${truncated}\n\`\`\``;
    }
    return `[Command failed] Exit: ${result.exitCode}\n\`\`\`\n${result.output}\n\`\`\``;
  }

  formatFileReadResult(result) {
    if (result.success) {
      const content = result.content || '';
      const lines = content.split('\n').length;
      const truncated = content.length > 5000 ? content.substring(0, 5000) + '\n... (truncated)' : content;
      return `[File] ${lines} lines\n\`\`\`\n${truncated}\n\`\`\``;
    }
    return `[Error] ${result.error}`;
  }

  formatFileWriteResult(result) { return result.success ? '[Success] File written' : `[Error] ${result.error}`; }
  formatGitStatusResult(result) { return result.success ? `[Git Status]\n\`\`\`\n${result.output}\n\`\`\`` : `[Error] ${result.error}`; }
  formatGitDiffResult(result) { return result.success ? `[Git Diff]\n\`\`\`diff\n${result.output}\n\`\`\`` : `[Error] ${result.error}`; }

  formatGenericResult(toolName, result) {
    if (result.success === false) return `[${toolName} failed] ${result.error || 'Unknown error'}`;
    if (typeof result === 'string') return result.length > 2000 ? result.substring(0, 2000) + '\n... (truncated)' : result;
    if (typeof result === 'object') {
      const json = JSON.stringify(result, null, 2);
      return json.length > 2000 ? json.substring(0, 2000) + '\n... (truncated)' : `[${toolName} result]\n\`\`\`json\n${json}\n\`\`\``;
    }
    return `[${toolName} result] ${String(result)}`;
  }
}

export const persistentConfig = new PersistentConfig();
export const pluginManager = new PluginManager();
export { USER_DIR, PROJECT_DIR, SESSIONS_DIR, SKILLS_DIR, MEMORY_DIR, LOGS_DIR, HOUSES_DIR };
export default persistentConfig;
