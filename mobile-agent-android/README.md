# OpenChat Mobile Agent (Android) · v0.1.0-alpha

Native Android coding companion. Branch: `mobile/android-agent-app-linear`.
Baseline: `docs/v0.1.0-alpha-BASELINE.md`. Prod prompt: `docs/PRODUCTION-LANDING-PROMPT.md`.

## Status
**Alpha / demo only. Not production.**

Works: Ask stream · Agent draft→human approve→GitHub PR · resume skeleton · encrypted settings · EditGate hash+LCS.

Blocks prod: zero tests · release unsigned/no minify · no Tool loop · no E2E resume proof · ADAPTIVE shell.

## Build
```bash
cd mobile-agent-android/app-android
./gradlew :app:assembleDebug
```
Requires JDK 17.

## Scope lock
Only `mobile-agent-android/`. DNA+HASHLINE are architecture anchors, not a full experiment port.
