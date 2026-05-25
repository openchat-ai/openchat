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

## Build

```bash
# Every push to main triggers CI:
#   bridge-lint → bridge-test → preflight → flutter-test → flutter-apk → Release
# APK with presigned URLs (24h valid) auto-generated at build time.
```

## Version

| Version | Date | Key changes |
|---------|------|-------------|
| v0.2.0 | 2026-05-22 | Qiniu Direct + SDUI + Debug channel + audio relay |
| v0.1.1 | 2026-05-21 | PM2 fix, CI Flutter, sandbox presets |
| v0.1.0 | 2026-05-21 | Flutter connectivity, port 3800 unified |
