# PeerTalk

Self-hosted P2P voice chat. Phone talks directly to Qiniu S3 — no server needed for voice.

## Architecture

```
Phone A ──→ Qiniu S3 ←── Phone B
                ↕ (optional)
              Bridge (AI residents, management)
```

- **Registration & discovery**: Phone writes/reads via Qiniu S3 API (upload token + presigned URL)
- **Signaling**: Call-request/accept/end via Qiniu (files under `oc/calls/`)
- **Audio**: PCM via Qiniu relay (`oc/audio/`), UDP hole punch when available
- **Bridge**: Optional. Runs AI residents, agent system, administration. Not needed for P2P voice.
- **Remote config**: `oc/config/` — change UI/text/behavior without rebuild
- **SDUI**: JSON→Flutter Widget engine — UI driven by remote config
- **Debug channel**: Write commands to Qiniu, phone executes and writes back

## Quick start

```bash
# Start Bridge (optional, for AI residents)
cd bridge && npm start

# Build APK (CI does this automatically)
# Download from GitHub Releases
```

## Tech stack

| Layer | Tech | Role |
|-------|------|------|
| App | Flutter 3.41 | Android APK |
| Storage | Qiniu S3 | Registration, signaling, audio relay |
| Backend | Node.js 24 | Bridge (optional, AI residents) |
| State | Riverpod 2.5 | Flutter state management |
| Audio | `record` + `audioplayers` | PCM capture & playback |
| Config | Remote SDUI | Server-driven UI engine |

## Project structure

```
bridge/          — Bridge server (optional)
openchat-flutter/ — Flutter APK
  lib/
    core/api/    — QiniuDirectClient, SDUI engine
    ui/screens/  — People, VoiceRoom, Settings, Home
scripts/         — gen-version.mjs (build-time URL generation)
tests/           — preflight.mjs, verify scripts
```

## Configuration

Bridge reads `~/.openchat/config.json` at startup. Most users only need to set provider credentials.

### Minimal config

```json
{
  "provider": {
    "minimax": {
      "options": {
        "baseURL": "https://api.minimaxi.com/anthropic/v1",
        "apiKey": "<YOUR_MINIMAX_KEY>"
      },
      "models": {
        "MiniMax-M3": { "name": "MiniMax-M3" }
      }
    }
  },
  "providers": {
    "openrouter": {
      "apiKey": "<YOUR_OPENROUTER_KEY>"
    }
  },
  "current": {
    "provider": "openrouter",
    "model": "openrouter/free"
  }
}
```

### Top-level fields

| Field | Required | Purpose |
|-------|----------|---------|
| `provider.<name>` | one of | Built-in provider preset with explicit baseURL (anthropic/openai/openrouter/minimax/qwen/...) |
| `providers.<name>.apiKey` | depends | API key for that provider |
| `current.provider` | yes | Active provider (must match a key in `provider.*` or `providers.*`) |
| `current.model` | yes | Model ID for the active provider |
| `bridge.*` | no | Bridge runtime (port 3800, mode, qiniu toggle, token budget) |
| `sessionHistory[]` | auto | Persisted session list (managed by bridge, do not edit) |

### Provider presets

Two ways to declare a provider:

- **`provider.<name>`** (object form) — explicit `baseURL` + `models` map. Use for vendors with non-default endpoints (Chinese models via OpenRouter, Anthropic-compatible proxies, etc.)
- **`providers.<name>.apiKey`** (shorthand) — just an API key; `baseURL` and models inferred from preset name. Use for stock OpenAI / Anthropic / OpenRouter.

For Chinese free models (Qwen / GLM / DeepSeek / MiniMax), prefer the object form with `baseURL` pointing at OpenRouter's free route, e.g. `model: "qwen/qwen-2.5-7b-instruct:free"`.

### Verify

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.HOME+'/.openchat/config.json','utf-8')).current)"
# → { provider: 'openrouter', model: 'openrouter/free' }
```

## Bridge Agent (optional)

When Bridge is running, the same IM channels (WeChat / Lark / Telegram) used for P2P voice signaling also route to an LLM agent:

```
Phone IM ──→ Qiniu S3 ──→ Bridge skeleton ──→ agent (LLM + tools) ──→ reply text
                              │
                              └─ session store (~/.openchat/sessions/)
```

- **Walking skeleton**: `apps/bridge/skeleton.mjs` — minimal headless agent loop, useful for E2E smoke test
- **Full engine**: `bridge/src/core/agent/agent-engine.js` — 2-pass agent (call tools → final answer), 20-token CoT prompt, response cache, context truncation
- **LLM provider**: `bridge/src/core/provider-service.js` — single import gate, all provider-kit calls go through here

## Build

```bash
# Every push to main triggers CI:
#   bridge-lint → bridge-test → preflight → flutter-test → flutter-apk → Release
# APK with presigned URLs (24h valid) auto-generated at build time.
```

## Version

| Version | Date | Key changes |
|---------|------|-------------|
| v0.3.0 | 2026-06-03 | Bridge agent E2E (IM → Qiniu → LLM → text), provider-kit single import gate, 2-pass agent, response cache |
| v0.2.0 | 2026-05-22 | Qiniu Direct + SDUI + Debug channel + audio relay |
| v0.1.1 | 2026-05-21 | PM2 fix, CI Flutter, sandbox presets |
| v0.1.0 | 2026-05-21 | Flutter connectivity, port 3800 unified |
