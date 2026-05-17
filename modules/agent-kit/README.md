# @openchat/agent-kit

**One API, 42 LLM providers, built-in agent loop.**

```js
import { createAgent } from '@openchat/agent-kit';

const agent = createAgent({
  providers: { openai: { apiKey: 'sk-...' } },
});

const reply = await agent.processStream('session-1', 'user-1', 'Hello', (event) => {
  if (event.type === 'content') console.log(event.content);
});
```

## What

A Node.js library that wraps 42 LLM providers (OpenAI, Anthropic, Ollama, OpenRouter, etc.) behind a single API, with a Think-Act-Verify agent loop that supports Function Calling, quality checks, and plugin hooks.

## Why

Every LLM provider has its own SDK, error format, and capabilities. This package gives you one consistent interface:

- **42 providers** — OpenAI, Anthropic, Google, Ollama, OpenRouter, and 38 more
- **Think-Act-Verify loop** — built-in agent with tool calling, streaming, quality checks, and self-correction
- **Pluggable validators** — register custom checkers (JSON schema, length, regex, or anything)
- **Provider error handling** — unified retry, timeout, and error format via `ProviderErrorAdapter`
- **Plugin hooks** — intercept every phase (beforeThink, afterThink, beforeAct, afterAct, beforeVerify, afterVerify)

## Quick start

```bash
npm install @openchat/agent-kit
```

```js
import { createAgent } from '@openchat/agent-kit';

const agent = createAgent({
  providers: {
    openai: { apiKey: process.env.OPENAI_API_KEY },
    ollama: { baseUrl: 'http://localhost:11434' },
  },
  pluginManager: { /* your tools */ },
  memory: { /* your context store */ },
  session: { /* your session store */ },
});

const stream = agent.processStream('sid', 'uid', '写一首诗', (event) => {
  if (event.type === 'content') process.stdout.write(event.content);
});
```

## API

### `createAgent(options)`

| Option | Type | Description |
|--------|------|-------------|
| `config` | object | AgentEngine config (maxIterations, qualityThreshold, etc.) |
| `pluginManager` | object | Optional. Must provide `getToolsForFunctionCalling()`, `executeTool()`, `formatToolResult()`, `execHook()` |
| `memory` | object | Optional. Must provide `getContext()`, `addMessage()`, `initialize()`, `retrieveRelevantContext()` |
| `session` | object | Optional. Must provide `getSession()` and `getProvider()` |

Returns `{ engine, processStream, process, AgentEvents }`.

## Relationship to @openchat/bridge

Bridge is a full application (HTTP server, WebSocket, P2P network, WebRTC signaling) that **uses** agent-kit internally. agent-kit is the core LLM + agent library without the networking layer — usable standalone in any Node.js project.

## License

MIT
