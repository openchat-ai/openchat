// Bridge-side provider-kit wrapper.
// This is the ONLY file that imports from 'provider-kit'.
// All other bridge code must use this service or go through sessionManager/agentEngine.
import { providerManager, providerRegistry, getRuntimeApiKey, getRuntimeBaseUrl, PRESET_PROVIDERS, DEFAULT_PROVIDER } from 'provider-kit';

export { getRuntimeApiKey, getRuntimeBaseUrl, PRESET_PROVIDERS, DEFAULT_PROVIDER };

export function getProviderConfig(type) {
  return providerManager.getProviderConfig(type);
}
export function listProviders() {
  return providerManager.listProviders();
}
export function getProvider(id) {
  return providerManager.getProvider(id);
}
export function listModels(provider) {
  return providerManager.listModels(provider);
}
export function getDefaultModel(providerName) {
  return providerManager.getDefaultModel(providerName);
}
export function addCustomProvider(name, baseUrl, apiKey, model) {
  return providerManager.addCustomProvider(name, baseUrl, apiKey, model);
}

export function listAll() {
  return providerRegistry.listAll();
}
export function listConfigured() {
  return providerRegistry.listConfigured();
}
export function getModels(providerId) {
  return providerRegistry.getModels(providerId);
}
export function refreshModels(providerId) {
  return providerRegistry.refreshModels(providerId);
}
export function configureProvider(providerId, config) {
  return providerRegistry.configure(providerId, config);
}

export function getProviderInstance(providerId) {
  return providerRegistry.getProvider(providerId);
}


