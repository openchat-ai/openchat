/**
 * Minimal in-memory config store for @openchat/provider-kit
 * Replace with your own persistent store in production.
 */
class PersistentConfig {
  constructor() { this._store = {}; this._apiKeys = {}; }
  getApiKey(provider) { return this._apiKeys[provider] || process.env[`${provider.toUpperCase()}_API_KEY`] || ''; }
  setApiKey(provider, key) { this._apiKeys[provider] = key; }
  removeApiKey(provider) { delete this._apiKeys[provider]; }
  getPreference(key) { return this._store[key]; }
  setPreference(key, val) { this._store[key] = val; }
  getBridgeConfig() { return this._store; }
}

export const persistentConfig = new PersistentConfig();
export default persistentConfig;
