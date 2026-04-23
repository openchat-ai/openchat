/**
 * OpenChat 配置管理
 *
 * 存储结构：
 *
 * 用户主目录 ~/.openchat/
 * └── config.json         # 唯一配置文件（服务商、密钥、模型）
 *
 * 项目目录 项目/.openchat/
 * ├── sessions/           # 会话数据
 * ├── skills/             # 技能库
 * ├── memory/             # 进化记忆
 * └── logs/               # 日志
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// 用户主目录
const USER_DIR = path.join(os.homedir(), '.openchat');
const CONFIG_FILE = path.join(USER_DIR, 'config.json');

// 项目目录
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const PROJECT_DIR = path.join(PROJECT_ROOT, '.openchat');
const SESSIONS_DIR = path.join(PROJECT_DIR, 'sessions');
const SKILLS_DIR = path.join(PROJECT_DIR, 'skills');
const MEMORY_DIR = path.join(PROJECT_DIR, 'memory');
const LOGS_DIR = path.join(PROJECT_DIR, 'logs');

// 默认配置
const DEFAULT_CONFIG = {
  providers: {},
  current: { provider: null, model: null },
  bridge: { port: 3000, apiPort: 3001 }
};

// ================== 工具函数 ==================

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson(file, defaultValue) {
  try {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    // 忽略错误
  }
  return defaultValue;
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ================== 配置管理类 ==================

class PersistentConfig {
  constructor() {
    ensureDir(USER_DIR);
    ensureDir(PROJECT_DIR);
    ensureDir(SESSIONS_DIR);
    ensureDir(SKILLS_DIR);
    ensureDir(MEMORY_DIR);
    ensureDir(LOGS_DIR);

    this.config = readJson(CONFIG_FILE, DEFAULT_CONFIG);
  }

  // ================== 提供商管理 ==================

  getProvider(name) {
    return this.config.providers?.[name] || null;
  }

  setProvider(name, cfg) {
    if (!this.config.providers) this.config.providers = {};
    this.config.providers[name] = cfg;
    this.save();
  }

  listProviders() {
    return Object.keys(this.config.providers || {});
  }

  getEnabledProviders() {
    const providers = this.config.providers || {};
    return Object.entries(providers)
      .filter(([_, cfg]) => cfg.enabled && cfg.apiKey)
      .map(([name, cfg]) => ({ name, ...cfg }));
  }

  // ================== API 密钥 ==================

  getApiKey(provider) {
    return this.config.providers?.[provider]?.apiKey || null;
  }

  setApiKey(provider, key) {
    if (!this.config.providers) this.config.providers = {};
    if (!this.config.providers[provider]) this.config.providers[provider] = {};
    this.config.providers[provider].apiKey = key;
    this.save();
  }

  // ================== 当前选择 ==================

  getCurrentProvider() {
    return this.config.current?.provider || null;
  }

  setCurrentProvider(name) {
    if (!this.config.current) this.config.current = {};
    this.config.current.provider = name;
    this.save();
  }

  getCurrentModel() {
    return this.config.current?.model || null;
  }

  setCurrentModel(model) {
    if (!this.config.current) this.config.current = {};
    this.config.current.model = model;
    this.save();
  }

  // ================== Bridge 配置 ==================

  getBridgeConfig() {
    return this.config.bridge || { port: 3000, apiPort: 3001 };
  }

  setBridgeConfig(cfg) {
    this.config.bridge = { ...this.config.bridge, ...cfg };
    this.save();
  }

  // ================== 记忆管理 ==================

  getMemory(topic) {
    const file = path.join(MEMORY_DIR, `${topic}.md`);
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }

  setMemory(topic, content) {
    fs.writeFileSync(path.join(MEMORY_DIR, `${topic}.md`), content);
  }

  listMemory() {
    if (!fs.existsSync(MEMORY_DIR)) return [];
    return fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));
  }

  // ================== 技能管理 ==================

  getSkillDir() {
    return SKILLS_DIR;
  }

  // ================== 通用偏好设置 ==================

  getPreference(key, defaultValue = null) {
    if (key === 'currentProvider') {
      return this.getCurrentProvider() || defaultValue;
    }
    if (key === 'currentModel') {
      return this.getCurrentModel() || defaultValue;
    }
    // 其他偏好存储在 config.preferences 中
    return this.config.preferences?.[key] ?? defaultValue;
  }

  setPreference(key, value) {
    if (!this.config.preferences) this.config.preferences = {};
    this.config.preferences[key] = value;
    this.save();
  }

  // ================== 保存 ==================

  save() {
    writeJson(CONFIG_FILE, this.config);
  }

  // ================== 路径信息 ==================

  getPaths() {
    return {
      configFile: CONFIG_FILE,
      projectDir: PROJECT_DIR,
      sessionsDir: SESSIONS_DIR,
      skillsDir: SKILLS_DIR,
      memoryDir: MEMORY_DIR,
      logsDir: LOGS_DIR
    };
  }
}

export const persistentConfig = new PersistentConfig();
export { USER_DIR, PROJECT_DIR, SESSIONS_DIR, SKILLS_DIR, MEMORY_DIR, LOGS_DIR };
export default persistentConfig;
