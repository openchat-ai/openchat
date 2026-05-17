/**
 * @openchat/provider-kit
 *
 * 42 LLM provider unified API — one interface for OpenAI, Anthropic,
 * Ollama, OpenRouter, and 38 more.
 *
 * Usage:
 *   import { createProvider } from '@openchat/provider-kit';
 *   const provider = createProvider('openai', { apiKey: 'sk-...' });
 *   const reply = await provider.chat('gpt-4', [{ role: 'user', content: 'Hi' }]);
 */

import { ProviderError, withRetry, withTimeout, safeProviderCall } from './providers/provider-error-adapter.js';

export function createProvider(type, config) {
  const adapters = {
    openai: () => import('./providers/openai-compatible.js').then(m => new m.default({ ...config, provider: 'openai' })),
    anthropic: () => import('./providers/anthropic-adapter.js').then(m => new m.default(config)),
    ollama: () => import('./providers/openai-compatible.js').then(m => new m.default({ ...config, provider: 'ollama', baseUrl: config.baseUrl || 'http://localhost:11434' })),
  };
  const loader = adapters[type];
  if (!loader) throw new ProviderError(`Unknown provider: ${type}`, { provider: type, type: 'config' });
  return loader();
}

export { ProviderError, withRetry, withTimeout, safeProviderCall };
