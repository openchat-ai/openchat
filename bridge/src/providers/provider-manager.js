/**
 * Bridge provider-manager — wraps @openchat/provider-kit
 */
import { ProviderManager as KitProviderManager, providerManager as kitProviderManager, PRESET_PROVIDERS as KitPresets } from '@openchat/provider-kit';
import { persistentConfig } from '../core/persistent-config.js';

export const ProviderManager = KitProviderManager;
export const providerManager = kitProviderManager;
export { KitPresets as PRESET_PROVIDERS };

// Bridge-specific: runtime API key management
let _defaultProvider = persistentConfig.getPreference('currentProvider') || 'openai';
let _aliases = {};

export const DEFAULT_PROVIDER = _defaultProvider;
export const PROVIDER_ALIASES = _aliases;

export function getRuntimeApiKey(providerName) {
  const key = persistentConfig.getApiKey(providerName);
  return key || process.env[`${providerName.toUpperCase()}_API_KEY`] || '';
}

export function reloadRuntimeConfig() {
  _defaultProvider = persistentConfig.getPreference('currentProvider') || 'openai';
}

export function getRuntimeBaseUrl(providerName) {
  const saved = persistentConfig.getPreference(`baseUrl_${providerName}`);
  return saved || process.env[`${providerName.toUpperCase()}_BASE_URL`] || '';
}

export function saveProviders() {}
export function updateProviderModels(providerKey, models) {}
export function addProviderEntry(providerKey, config) {}
