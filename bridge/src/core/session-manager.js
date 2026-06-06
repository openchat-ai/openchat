import crypto from 'crypto';
import { providerRegistry } from 'provider-kit';
import { persistentStore } from './persistent-store.js';
import { persistentConfig } from './persistent-config.js';
import logger from './monitoring/logger.js';

export class SessionManager {
  constructor() {
    this.providers = new Map();
  }

  async addProvider(type, apiKey = null, endpoint = null) {
    if (this.providers.has(type)) {
      const existing = this.providers.get(type);
      if (existing.connected) {
        return existing;
      }
      this.providers.delete(type);
    }

    const effectiveKey = apiKey || persistentConfig.getApiKey(type);
    if (!effectiveKey) {
      throw new Error(`No API key for ${type}. Set with: config set ${type} <api_key>`);
    }

    const provider = providerRegistry.getProvider(type);
    if (!provider) {
      throw new Error(`Unknown provider type: ${type}`);
    }

    await provider.connect(effectiveKey);
    this.providers.set(type, provider);

    logger.info(`✓ Connected to ${provider.name}`);
    return provider;
  }
