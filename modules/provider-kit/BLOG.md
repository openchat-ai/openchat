# I Built a Zero-Dependency Library That Unifies 42 LLM Providers Into One API

Every LLM provider has its own SDK, its own error format, its own auth method.

OpenAI uses `fetch` with a Bearer token. Anthropic has `@anthropic-ai/sdk`. Ollama runs on localhost:11434 with a completely different API shape. Azure OpenAI requires a resource name and deployment ID. Google Gemini has yet another SDK.

**Switching providers means rewriting every integration.** I've done this three times and decided: never again.

So I built `provider-kit` — one `chat()` function that works across 42 providers. Zero dependencies. 21 kB.

```js
import { createProvider } from 'provider-kit'

const provider = await createProvider('openai', process.env.OPENAI_API_KEY)
const reply = await provider.chat('gpt-4o-mini', [
  { role: 'user', content: 'Hello' }
])
// Works the same for Anthropic, Ollama, Gemini, and 38 more
```

## The Problem

I was building an AI chat application that needed to support multiple LLM backends. The requirements were:

1. Users could bring their own API key (OpenAI, Anthropic, or local Ollama)
2. The system should automatically fall back if a provider was down
3. Error handling had to be consistent — no guessing whether a 429 was rate limiting or a 500 was server error

The existing solutions were either:
- **Heavy**: LangChain (900 kB+), Vercel AI SDK (framework-specific)
- **Python-only**: LiteLLM requires a Python runtime
- **SaaS**: OpenRouter adds latency and a middleman

I wanted something **lightweight, zero-dependency, and JavaScript-native**.

## The Solution: provider-kit

```bash
npm install provider-kit
```

That's it. No config files, no environment setup, no million-line `node_modules`.

### One API for 42 Providers

```js
import { createProvider } from 'provider-kit'

// OpenAI
const openai = await createProvider('openai', process.env.OPENAI_API_KEY)
await openai.chat('gpt-4', messages)

// Anthropic
const claude = await createProvider('anthropic', process.env.ANTHROPIC_API_KEY)
await claude.chat('claude-3-haiku', messages)

// Ollama (local)
const ollama = await createProvider('ollama', null, { baseUrl: 'http://localhost:11434' })
await ollama.chat('llama3.2', messages)
```

Every provider returns the same response format: `{ content, model, usage }`. No adapter code needed.

### Auto-Routing with Health Probes

The real differentiator is `createRouter`. It periodically probes each model's availability and routes requests to the best one — **in real time, with no restart**.

```js
import { createRouter } from 'provider-kit'

const router = createRouter({
  probes: [
    { provider: 'openai',   model: 'gpt-4',        apiKey: process.env.OPENAI_API_KEY },
    { provider: 'openai',   model: 'gpt-4o-mini',  apiKey: process.env.OPENAI_API_KEY },
    { provider: 'ollama',   model: 'llama3.2',     baseUrl: 'http://localhost:11434' },
  ],
  strategy: 'latency',         // lowest latency wins
  probeInterval: 30000,         // check every 30 seconds
  onProbeResult: (results) => console.log(results),
})

const reply = await router.chat([{ role: 'user', content: 'Hello' }])
// → auto-routed to the healthiest available model
```

If GPT-4 is rate-limited, it automatically falls to GPT-4o-mini. If the network is down, it routes to local Ollama. When the external provider recovers, the next probe detects it and routing adjusts.

### Consistent Error Handling

Every error is a `ProviderError` with a standard structure:

| Type | Meaning | Retryable |
|------|---------|-----------|
| `rate_limit` | Too many requests | ✅ |
| `auth` | Bad API key | ❌ |
| `timeout` | Provider didn't respond | ✅ |
| `server_error` | 5xx error | ✅ |
| `quota` | Token budget exhausted | ❌ |
| `bad_request` | Invalid input | ❌ |
| `network` | DNS/connection failure | ✅ |

```js
try {
  const reply = await provider.chat('gpt-4', messages)
} catch (e) {
  console.log(e.type)         // "rate_limit"
  console.log(e.retryable)    // true
  console.log(e.message)      // "Rate limit exceeded - slow down or upgrade your plan"
}
```

### Observability Built In

Wrap any provider with `createMonitor` to track latency, errors, and token usage:

```js
import { createMonitor } from 'provider-kit'

const monitor = createMonitor({
  onCall: (record) => {
    console.log(`${record.provider}: ${record.latency}ms, ok=${record.ok}`)
  }
})

const tracked = monitor.wrap(await createProvider('openai', key))
await tracked.chat('gpt-4', messages)  // onCall fires automatically
```

### Function Calling

```js
const reply = await provider.chat('gpt-4', messages, {
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      parameters: { type: 'object', properties: { city: { type: 'string' } } }
    }
  }]
})
if (reply.toolCalls) {
  console.log(reply.toolCalls[0].name)  // "get_weather"
}
```

## The Numbers

- **21 kB** unpacked, **zero dependencies**
- **43 tests** (39 unit + 4 E2E), all passing
- **v1.2.2**, semver stable since v1.0.0
- **14 source files**, easy to audit and contribute to

## How It Started

provider-kit started as a utility module inside a larger project called OpenChat Bridge — a P2P messaging + AI resident platform. After three rounds of refactoring, I realized the provider abstraction layer was the most valuable part. So I extracted it, polished it, and published it as a standalone package.

The entire process — from initial code to npm publish to GitHub release — took about a week of focused work, but the concepts had been brewing for months.

## What's Next

- More provider adapters (currently 10 implemented, 32 via OpenAI-compatible fallback)
- TypeScript types
- CLI benchmarking tool (`provider-kit bench`)
- Your contributions are welcome!

## Try It

```bash
npm install provider-kit
```

And run the 60-second quickstart:

```bash
export OPENAI_API_KEY=sk-...
node -e "
import('provider-kit').then(({ createProvider }) => {
  const p = await createProvider('openai', process.env.OPENAI_API_KEY)
  const stream = p.chatStream('gpt-4o-mini', [{ role: 'user', content: 'Say hello' }])
  for await (const c of stream) { if (c.type === 'content') process.stdout.write(c.content) }
})"
```

---

- GitHub: [openchat-ai/provider-kit](https://github.com/openchat-ai/provider-kit)
- npm: [`provider-kit`](https://www.npmjs.com/package/provider-kit)
- Twitter/X: [@yourhandle]  <!-- Replace with your social link -->

*Written by the maintainer of provider-kit and fairy-guardian.*
