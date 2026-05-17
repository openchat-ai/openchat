/**
 * Persistent config for @openchat/provider-kit
 * Stores API keys and preferences to ~/.openchat/provider-kit.json
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const CONFIG_DIR = join(homedir(), '.openchat');
const CONFIG_PATH = join(CONFIG_DIR, 'provider-kit.json');

class PersistentConfig {
  constructor() {
    this._store = {};
    this._apiKeys = {};
    this._load();
  }

  _load() {
    try {
      if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
      if (existsSync(CONFIG_PATH)) {
        const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
        this._store = data.store || {};
        this._apiKeys = data.apiKeys || {};
      }
    } catch (e) {
      // Corrupted file — start fresh
      this._store = {};
      this._apiKeys = {};
    }
  }

  _save() {
    try {
      if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(CONFIG_PATH, JSON.stringify({ store: this._store, apiKeys: this._apiKeys }, null, 2), 'utf8');
    } catch (e) {
      console.warn('[provider-kit] Failed to save config:', e.message);
    }
  }

  getApiKey(provider) {
    return this._apiKeys[provider] || process.env[`${provider.toUpperCase()}_API_KEY`] || '';
  }

  setApiKey(provider, key) {
    this._apiKeys[provider] = key;
    this._save();
  }

  removeApiKey(provider) {
    delete this._apiKeys[provider];
    this._save();
  }

  listKeys() {
    return Object.keys(this._apiKeys);
  }

  getPreference(key) {
    return this._store[key];
  }

  setPreference(key, val) {
    this._store[key] = val;
    this._save();
  }

  getBridgeConfig() {
    return this._store;
  }
}

export const persistentConfig = new PersistentConfig();
export default persistentConfig;
