# Changelog

## v0.2.0 (2026-05-22)

### Added
- Qiniu Direct architecture — phone reads/writes S3 directly, no Bridge needed
- UDP hole punch with public IP discovery
- SDUI engine — remote config drives UI without rebuild
- Debug command channel — write commands to Qiniu, phone executes and writes back
- Remote config — `oc/config/global.json`, `oc/config/ui_people.json`
- Demo mode — single-phone testing with simulated peer
- Real audio recording/playback (record → Qiniu relay → play)
- CI preflight gate — `node tests/preflight.mjs` must pass before APK build
- Auto cleanup — old releases and workflow runs deleted after each build
- Pre-generated S3 presigned URLs at build time (24h, avoids V4 signing bug)
- App version display in Settings page
- Error diagnostics — errors now show type (timeout/auth/DNS) + guidance

### Changed
- Removed Bridge TCP/WebSocket dependency for P2P voice
- User discovery via filename extraction (no individual S3 GET needed)
- PeopleScreen driven by remote UI config when available
- Settings page: version shown as separate sliver (no layout overflow)
- AndroidManifest: added INTERNET + RECORD_AUDIO permissions

### Removed
- Hyperswarm/DHT (Node 24 incompatible, China network restrictions)
- WebRTC (`flutter_webrtc` + `web_socket_channel` deps)
- WebSocket signaling (TCP 3801)
- iOS/Linux/Windows/macOS Flutter platform files (+4114 lines)
- Bridge HTTP API dependency for phone operations

## v0.1.0 (2026-05-18)

### Added
- P2P voice communication foundation (hyperswarm DHT + WebRTC)
- Agent engine Think-Act-Verify loop
- EvolutionMemory with file persistence
- RNNoise WASM audio denoising integration
- Neural audio codec (feature-based, 32 kbps target)
- Flutter mobile client with Riverpod state management
- provider-kit npm package (42 LLM provider unified API)
- fairy-guardian npm package (self-healing process clusters)
- CI pipeline (GitHub Actions)
- API authentication (Bearer Token)
- Bridge Health check endpoint

### Fixed
- EvolutionMemory getProgress() scope prefix bug
- Flutter file encoding corruption causing build failures
- Multiple TODO stubs replaced with real NeuralAudioCodec calls

### Changed
- main.js reduced from ~1900 to 26 lines (dead code cleanup)
- Project migrated to ESM-only module system
- All documentation port/line-count references corrected
- Branch workflow enforced via pre-push hook
