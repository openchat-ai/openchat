# Contributing

## Quick start

```bash
git clone https://github.com/openchat-ai/openchat.git
cd bridge
npm install
npm test    # 40 tests should pass
npm start   # Start Bridge locally
```

## Where to contribute

| Area | Files | Good for |
|------|-------|----------|
| LLM providers | `modules/provider-kit/src/providers/` | Adding new provider adapters |
| Agent loop | `bridge/src/core/agent-engine.js` | Improving Think-Act-Verify |
| Memory | `bridge/src/core/evolution-memory.js` | Memory recall/search strategies |
| Web UI | `bridge/src/main.js` (_mountLegacyRoutes) | Dashboard / live chat |
| Flutter | `openchat-flutter/` | Mobile client |

## Commit format

```
type: short description (English + Chinese)

type: feat / fix / refactor / test / docs / chore
```

## Before submitting

- `npm test` passes (bridge)
- `npm test` passes (modules/provider-kit)
- `npm audit` passes
