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
import { randomUUID } from 'crypto';

// 用户主目录（支持环境变量覆盖配置路径）
const USER_DIR = process.env.OPENCHAT_HOME || path.join(os.homedir(), '.openchat');
const CONFIG_FILE = process.env.OPENCHAT_CONFIG || path.join(USER_DIR, 'config.json');

// 项目目录
const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const PROJECT_DIR = path.join(PROJECT_ROOT, '.openchat');
const SESSIONS_DIR = path.join(PROJECT_DIR, 'sessions');
const SKILLS_DIR = path.join(PROJECT_DIR, 'skills');
const MEMORY_DIR = path.join(PROJECT_DIR, 'memory');
const LOGS_DIR = path.join(PROJECT_DIR, 'logs');
const HOUSES_DIR = path.join(USER_DIR, 'houses');

// 默认配置
const DEFAULT_CONFIG = {
  providers: {},
  current: { provider: null, model: null },
  bridge: {
    mode: 'headless',
    port: 3000,
    name: '',
    region: '',
    dhtPort: 0,
    localBootstrap: [],
    directListen: 0,
    directConnect: [],
    topic: 'openchat-community',
    wsSignaling: '',
    advertiseHost: '',
    qiniuEnabled: true,
    cores: [],
    deployServerEnabled: false,
    deployServerPort: 8080,
    llmDailyTokenBudget: 1000000,
    llmCacheEnabled: true,
    residentThinkMinInterval: 5
  }
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
    ensureDir(HOUSES_DIR);

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
    const p = this.config.providers?.[provider];
    return p?.apiKey || p?.options?.apiKey || null;
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

  /**
   * 解析模型名：从 providers.models map（key → {name}）反查
   * 如果 model 直接匹配某个 key 则直接返回，如果匹配 display name 则返回对应 key
   * 这样用户配置显示名称（如 "Qianfan Code Latest"）时也能正确映射到 API 模型 key
   */
  resolveModelName(providerName, model) {
    if (!model || !providerName) return null;
    const providerCfg = this.getProvider(providerName);
    const models = providerCfg?.models;
    if (!models) return null;

    // 直接匹配 key
    if (models[model]) return model;

    // 反查：displayName → key
    for (const [key, val] of Object.entries(models)) {
      if (val.name === model || val.displayName === model) {
        return key;
      }
    }

    return null;
  }

  // ================== Bridge 配置 ==================

  getBridgeConfig() {
    this.ensureHostId();
    return { ...DEFAULT_CONFIG.bridge, ...(this.config.bridge || {}) };
  }

  setBridgeConfig(cfg) {
    const oldHostId = this.config.bridge?.hostId || '';
    this.config.bridge = { ...DEFAULT_CONFIG.bridge, ...this.config.bridge, ...cfg };
    // 保护 hostId 不被意外覆盖
    if (oldHostId) this.config.bridge.hostId = oldHostId;
    this.save();
  }

  /** 确保 hostId 已生成 — 首次启动时创建 UUID，之后复用 */
  ensureHostId() {
    if (!this.config.bridge) this.config.bridge = {};
    if (!this.config.bridge.hostId) {
      this.config.bridge.hostId = randomUUID();
      this.save();
    }
    return this.config.bridge.hostId;
  }

  /** 获取本机 hostId */
  getHostId() {
    return this.ensureHostId();
  }

  /** 增加年龄（每次升级调用） */
  incrementAge() {
    if (!this.config.bridge) this.config.bridge = {};
    this.config.bridge.age = (this.config.bridge.age || 0) + 1;
    this.save();
    return this.config.bridge.age;
  }

  /** 获取当前年龄 */
  getAge() {
    return this.config.bridge?.age || 0;
  }

  /** 设置智商年龄（居民评估结果） */
  setMentalAge(age) {
    if (!this.config.bridge) this.config.bridge = {};
    this.config.bridge.mentalAge = age;
    this.config.bridge.mentalAgeEvaluatedAt = Date.now();
    this.save();
  }

  /** 获取智商年龄 */
  getMentalAge() {
    return this.config.bridge?.mentalAge || 0;
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
    // currentProvider / currentModel 写入规范位置 config.current，不走 preferences
    if (key === 'currentProvider') {
      return this.setCurrentProvider(value);
    }
    if (key === 'currentModel') {
      return this.setCurrentModel(value);
    }
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
      logsDir: LOGS_DIR,
      housesDir: HOUSES_DIR
    };
  }
}

export const persistentConfig = new PersistentConfig();
export { USER_DIR, PROJECT_DIR, SESSIONS_DIR, SKILLS_DIR, MEMORY_DIR, LOGS_DIR, HOUSES_DIR };
export default persistentConfig;
