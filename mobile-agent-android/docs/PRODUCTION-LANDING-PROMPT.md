# PROMPT · mobile-agent-android → production
Copy all below into a new session. Do not expand scope.

---
You are shipping `mobile-agent-android/` to production on branch `mobile/android-agent-app-linear`.
Baseline: v0.1.0-alpha (`docs/v0.1.0-alpha-BASELINE.md`). DNA+HASHLINE=anchor. No bridge/Flutter.

## Iron rules
1. Only touch `mobile-agent-android/`. One feature = one commit. Diff≤500. File≤200 lines; >100 need `// === invariants ===`.
2. Reply ≤4 lines. No essays. Fix>report. No push until user says yes after 3-check:
   - path-trace · local verify (gradle/test) · adversarial "what crashes?"
3. Prefer smallest change. No speculative refactors. No new deps unless blocked.
4. Secrets only EncryptedSharedPreferences. Never external/backup/log.

## Goal order (stop at first FAIL gate)
G1 tests+CI  
G2 release harden (minify+R8+sign config template, no real key in repo)  
G3 single persistence source (kill dual snapshot write)  
G4 Tool loop: `read_file` `hash_edit(EditGate)` `list_tree` (GitHub API) wired in AgentLoop  
G5 E2E script/doc: start→checkpoint interrupt→resume→PR  
G6 ADAPTIVE real router or remove mode  
Ship tag `v0.1.0` only when G1–G5 green.

## Context (do not re-read whole tree)
Key files:
- `AgentService.kt` IO+single loopJob+AgentFailure
- `AgentLoop.kt` plan/preview/publish+resume
- `AgentStatusHub.kt` state/log/failures/commands
- `AppRuntimeState.kt` reducer; Idle keeps recovery
- `AppSettingsStore.kt` encrypted; external scrubbed
- `EditGate.kt` MD5-8 + LCS diff
- `MainActivity.kt` UI+failure collect
- `GitHubClient.kt` / `ModelRouter.kt`

## Work method
For each G#:
1. Read only needed files (≤3).
2. Spec if new .kt >50 lines (`docs/spec-template` style: flow/API/bounds/invariants/C-logs).
3. Implement minimal.
4. Verify: `./gradlew :app:test :app:assembleDebug` (release when G2).
5. Commit `fix|feat(mobile-agent): ...` lowercase subject.
6. Report: done / residual risk / push? — wait.

## Acceptance (prod)
- [ ] unit tests: EditGate, reduce(AgentFailed/Observe Idle), loop single-flight
- [ ] assembleRelease with minify true
- [ ] no apiKey/token in any file write except encrypted prefs
- [ ] interrupt at approval → cold start → Resume → PR
- [ ] mutating step always checkpoint+EditGate hash
- [ ] README matches reality (delete stub lies)

## Anti-goals
No full IDE. No auto-approve. No cleartext. No multi-agent. No bridge ports.

Start at G1. First message: 3-bullet plan then code.
---
