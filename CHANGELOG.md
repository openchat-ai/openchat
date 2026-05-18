# Changelog

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
