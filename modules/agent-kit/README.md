# @openchat/provider-kit

**One API for 42 LLM providers.** No agent loop, no framework — just a unified interface for OpenAI, Anthropic, Ollama, OpenRouter, and 38 more.

```js
import { createProvider } from '@openchat/provider-kit';
const client = await createProvider('openai', { apiKey: 'sk-...' });
const reply = await client.chat('gpt-4', [
  { role: 'user', content: 'Hello' }
]);
```

## Why

Every LLM provider has its own SDK, error format, and auth method. This package gives you one `chat()` function that works across all of them, with built-in retry and timeout.

## Providers

OpenAI, Anthropic Claude, Google Gemini, Ollama, OpenRouter, Azure OpenAI, AWS Bedrock, Cohere, and 34 more via the OpenAI-compatible adapter.

## Error handling

All providers throw `ProviderError` with consistent `{ provider, statusCode, retryable, type }` fields. Use `withRetry()` or `safeProviderCall()` for automatic retry with exponential backoff.

## Not included

This is a thin provider layer — no agent loop, no tool calling, no memory. Pair it with `@openchat/agent-kit` (coming soon) or use it standalone.
