# Changelog

All notable changes to provider-kit.

## [1.4.0] - 2026-06-06

### Fixed (from expert review P0)

- **#1 Sync race in `getProvider`**: `chat()` could throw "Provider not connected" when called before the fire-and-forget `connect()` finished. Now providers are synchronously marked `connected = true` if `apiKey` is set, with async validation running in background.
- **#3 Config file permissions (0600)**: `persistent-config` now writes configs with mode `0o600` and tightens permissions on load (Unix only; Windows ignored). API keys no longer world-readable.
- **#2 `ProviderRegistry.dispose()`**: New `dispose()` method disconnects all providers and clears `providers` / `models` / `_modelTimestamps` maps. Use for HMR, test cleanup, process exit.
- **#5 `withRetry` 4xx/5xx classification**:
  - Previously `'4'` substring in error message would mis-classify (e.g., IP `127.0.0.1:443` matched as `bad_request`).
  - Now uses `\bN{3}\b` word boundaries. Network errors (`ECONNREFUSED`/`ENOTFOUND`/`fetch failed`) are correctly retryable.
  - Non-ProviderError errors are run through `classifyError` so retryable flag is honored.

### Added

- `RouterProvider` multi-protocol routing (race / failover) per model via `~/.config/openchat/config.json` `adapter.<model>.<protocol>.baseURL`.
- 7 new regression tests in `test/regression.test.js`.

### Changed

- `classifyError` reordering: network/timeout checked first (most specific), then 4xx/5xx (avoid `4` substring false positives).
- ProviderError `auth` type now matches "api key" / "apikey" / "invalid key" in messages.

## [1.3.9] and earlier

See git history.
