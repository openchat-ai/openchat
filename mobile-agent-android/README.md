# OpenChat Mobile Agent (Android) · v0.1.0-alpha

Native Android coding companion. Branch: `mobile/android-agent-app-linear`.
Baseline: `docs/v0.1.0-alpha-BASELINE.md`. Prod prompt: `docs/PRODUCTION-LANDING-PROMPT.md`.

## Status
**Alpha. Not production.**

Works: Ask stream · Agent draft→human approve→GitHub PR · resume · encrypted settings · EditGate · G1 unit tests · release APK with minify+signing · GitHub tools (list_tree/read_file/hash_edit) · ADAPTIVE routing.

Blocks prod: no local file tools · no git push from phone · no CI poll loop · missing G7–G10.

## Build
```bash
cd mobile-agent-android/app-android
./gradlew :app:assembleDebug
```
Requires JDK 17.

## Scope lock
Only `mobile-agent-android/`. DNA+HASHLINE are architecture anchors, not a full experiment port.
