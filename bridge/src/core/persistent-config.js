import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.openchat');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const MEMORY_DIR = path.join(CONFIG_DIR, 'memory');
const SKILLS_DIR = path.join(CONFIG_DIR, 'skills');
const SESSIONS_DIR = path.join(CONFIG_DIR, 'sessions');

// No encryption - store API keys as plain text
class SecureStorage {
  encrypt(text) {
    return text;  // Return plain text
  }

  decrypt(encrypted) {
    return encrypted;  // Return plain text
  }
}

const secureStorage = new SecureStorage();

class PersistentConfig {
  constructor() {
    this.config = this.load();
  }

  ensureDirs() {
    for (const dir of [CONFIG_DIR, MEMORY_DIR, SKILLS_DIR, SESSIONS_DIR]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  load() {
    this.ensureDirs();
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        return JSON.parse(raw);
      } catch {
        return { apiKeys: {}, preferences: {}, history: [] };
      }
    }
    return { apiKeys: {}, preferences: {}, history: [] };
  }

  save() {
    this.ensureDirs();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  getApiKey(provider) {
    const encrypted = this.config.apiKeys?.[provider];
    if (!encrypted) return null;
    return secureStorage.decrypt(encrypted);
  }

  setApiKey(provider, key) {
    if (!this.config.apiKeys) this.config.apiKeys = {};
    this.config.apiKeys[provider] = secureStorage.encrypt(key);
    this.save();
    return true;
  }

  removeApiKey(provider) {
    if (this.config.apiKeys?.[provider]) {
      delete this.config.apiKeys[provider];
      this.save();
      return true;
    }
    return false;
  }

  listProviders() {
    return Object.keys(this.config.apiKeys || {});
  }

  getPreference(key, defaultValue = null) {
    return this.config.preferences?.[key] ?? defaultValue;
  }

  setPreference(key, value) {
    if (!this.config.preferences) this.config.preferences = {};
    this.config.preferences[key] = value;
    this.save();
  }

  getRecentSessions(limit = 10) {
    return (this.config.history || []).slice(-limit);
  }

  addSessionToHistory(sessionId, provider, model) {
    if (!this.config.history) this.config.history = [];
    this.config.history.push({
      id: sessionId,
      provider,
      model,
      timestamp: Date.now()
    });
    if (this.config.history.length > 50) {
      this.config.history = this.config.history.slice(-50);
    }
    this.save();
  }

  // 获取最近使用的模型（去重）
  getRecentModels(limit = 10) {
    const history = this.config.history || [];
    const seen = new Set();
    const result = [];

    // 从最新到最旧遍历
    for (let i = history.length - 1; i >= 0 && result.length < limit; i--) {
      const item = history[i];
      if (item.provider && item.model) {
        const key = `${item.provider}/${item.model}`;
        if (!seen.has(key)) {
          seen.add(key);
          result.push({
            provider: item.provider,
            model: item.model,
            timestamp: item.timestamp
          });
        }
      }
    }

    return result;
  }

  // 记录模型使用
  recordModelUse(provider, model) {
    if (!this.config.history) this.config.history = [];
    this.config.history.push({
      id: `model-${Date.now()}`,
      provider,
      model,
      timestamp: Date.now()
    });
    if (this.config.history.length > 50) {
      this.config.history = this.config.history.slice(-50);
    }
    this.save();
  }

  getMemory(topic) {
    const memFile = path.join(MEMORY_DIR, `${topic}.md`);
    if (fs.existsSync(memFile)) {
      return fs.readFileSync(memFile, 'utf8');
    }
    return null;
  }

  setMemory(topic, content) {
    const memFile = path.join(MEMORY_DIR, `${topic}.md`);
    fs.writeFileSync(memFile, content);
  }

  listMemory() {
    if (!fs.existsSync(MEMORY_DIR)) return [];
    return fs.readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''));
  }
}

export const persistentConfig = new PersistentConfig();
export { CONFIG_DIR, MEMORY_DIR, SKILLS_DIR, SESSIONS_DIR };
export default persistentConfig;