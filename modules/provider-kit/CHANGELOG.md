# Changelog

## 0.1.0 (unreleased)

- Initial release
- 10 provider adapters: OpenAI, Anthropic, Azure, Bedrock, Cohere, Gemini, Ollama, Local, OpenAI-compatible
- `ProviderError` with retryable flag and typed metadata
- `withRetry()` exponential backoff utility
- `withTimeout()` race-based timeout utility
- `safeProviderCall()` combined retry + timeout
- `ProviderRegistry` + `providerRegistry` singleton
- `createProvider()` factory with preset configs
- 19 unit tests covering error paths, retry behavior, security audit
- Node.js 18+
