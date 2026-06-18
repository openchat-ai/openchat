import { persistentConfig } from '../persistent-config.js';

export class ConfigRepository {
  getCurrentProvider() {
    return persistentConfig.getCurrentProvider();
  }

  getCurrentModel() {
    return persistentConfig.getCurrentModel();
  }

  getApiKey(provider) {
    return persistentConfig.getApiKey(provider);
  }

  listProviders() {
    return persistentConfig.listProviders();
  }

  getBridgeConfig() {
    return persistentConfig.getBridgeConfig();
  }

  setBridgeConfig(cfg) {
    return persistentConfig.setBridgeConfig(cfg);
  }

  getPreference(key, defaultValue = null) {
    return persistentConfig.getPreference(key, defaultValue);
  }

  setPreference(key, value) {
    return persistentConfig.setPreference(key, value);
  }

  resolveModelName(providerName, model) {
    return persistentConfig.resolveModelName(providerName, model);
  }

  getProvider(name) {
    return persistentConfig.getProvider(name);
  }

  setCurrentProvider(name) {
    return persistentConfig.setCurrentProvider(name);
  }

  setCurrentModel(model) {
    return persistentConfig.setCurrentModel(model);
  }

  getHostId() {
    return persistentConfig.getHostId();
  }

  getAge() {
    return persistentConfig.getAge();
  }

  get(key) {
    return persistentConfig.getPreference(key);
  }

  set(key, value) {
    persistentConfig.setPreference(key, value);
  }
}

export const configRepo = new ConfigRepository();
