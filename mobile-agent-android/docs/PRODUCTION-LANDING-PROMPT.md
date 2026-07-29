# PROMPT · mobile-agent-android → production
> Paste everything under `BEGIN` into a new session. Do not invent scope.

BEGIN
You ship `mobile-agent-android/` only on branch `mobile/android-agent-app-linear`.
Baseline tag: `mobile-agent-v0.1.0-alpha` @ `docs/v0.1.0-alpha-BASELINE.md`.
DNA+HASHLINE = architecture anchors (EditGate MD5-8 + ordered diff). Not a full experiment port. No bridge. No Flutter.

# Mission
Make the alpha path **reliably runnable end-to-end**, then harden to a signed `v0.1.0`.
Product is a mobile coding companion: Ask stream + human-approved Agent draft→PR. Not a mobile IDE.

# Iron rules
1. Scope: only `mobile-agent-android/**`. One feature = one commit. Diff ≤500. `.kt` ≤200 lines; >100 needs `// === invariants ===`. New `.kt` >50 lines needs sibling `.spec.md` (flow/API/bounds/invariants/C-logs).
2. Token: reply ≤4 lines while coding. No essays, no full-tree scans. Read ≤3 files before each edit.
3. **Build/test ONLY via GitHub Actions** workflow `.github/workflows/mobile-agent-android.yml`.
   - Do **NOT** run local `gradle`/`gradlew`/`assemble*`/`test*` to claim pass/fail.
   - Local JDK/Gradle paths are irrelevant. Flutter is irrelevant.
   - After push: `gh run list --workflow=mobile-agent-android.yml` / wait for green.
   - No CI green = gate not done. Never fake pass.
4. Push gate: after code, report 3-check then ask `可以推吗?` and WAIT.
   - path-trace (name crash points)
   - CI plan: which jobs must go green (unit test + assembleDebug; release when G4)
   - adversarial: dual-loop / secret leak / resume plan regen / recovery wipe
5. Secrets: only `EncryptedSharedPreferences`. Never write apiKey/token to external file, logs, notifications, PR body, or plain prefs.
6. Commit subject lowercase: `fix|feat|test|chore(mobile-agent): ...`
7. Do not regenerate TaskPackage on resume. Do not auto-resume on launch. Do not auto-approve.

# Known landmines (regression = FAIL)
L1 MAIN THREAD: Agent network/plan/publish must stay on `Dispatchers.IO`. `AgentService` uses single `loopJob`; second start/resume must no-op.
L2 DUAL PERSIST (active bug): `MainActivity` writes snapshot to BOTH
   - `PersistenceManager` prefs `agent_runtime` (via `runtimeState` setter → `save`)
   - `AppSettingsStore` encrypted key `runtime_snapshot` (via `dispatch` → `saveRuntimeSnapshot`)
   But `AgentService` resume reads **only** `PersistenceManager`.
   Any recovery change must keep Service resume source == UI resume source. Prefer **one writer**: PersistenceManager for runtime; SettingsStore for secrets/settings only.
L3 RECOVERY WIPE: `ObserveAgent(Idle)` must NOT clear `needsResume` / `pendingTaskPackage`. Only `Completed` or explicit `ClearRecovery` clears. `AgentFailed` owns Idle+recovery; Service must not race-push Idle before failure event is reduced.
L4 FAILED PAYLOAD: Failed/Cancelled must carry `goal + taskPackage? + checkpointId?` into `RuntimeAction.AgentFailed` via `AgentStatusHub.failures`.
L5 RESUME SEMANTICS: `AgentLoop.resume(tp, checkpointId)` rebuilds queue from saved package; **never** calls plan/LLM when package exists. Missing checkpoint → first checkpoint. Already-published branch may exist → publish path must handle 422/exists (fetch head / reuse branch), not crash.
L6 EDITGATE: hash = MD5 hex first 8. `diff` = ordered LCS line diff, not set-difference `filterNot { in }`.
L7 STOP RACE: Stop = `reject()` + `loopJob.cancel()`; Cancelled must be single-fire (`if (!cancelled)`). Approval channel drained before wait.
L8 NETWORK: `network_security_config` cleartext=false, system CA only. `allowBackup=false`. Provider baseUrl must be https.
L9 TOOLS: `core/tools/Tool.kt` is interface-only today. AgentLoop still plans text drafts without tool calls. Don't claim "agent coding" until tools are wired + gated.
L10 RELEASE: minify currently false; no signing config. Don't commit real keystores.

# Gate order (finish & verify each before next)
## G1 — tests that lock landmines
Add unit tests under `app/src/test/java/...` (robolectric only if unavoidable; prefer pure JVM):
- EditGate: same→empty diff; reorder lines; HASH_STALE on tampered snapshot
- `AppRuntimeState.reduce`: AgentFailed keeps package; ObserveAgent(Idle) keeps recovery; Completed clears
- AgentLoop single-flight: second `run()` while active is no-op (scripted provider)
- (if pure-JVM hard) extract pure functions rather than skip
CI: `.github/workflows/mobile-agent-android.yml` must run `:app:testDebugUnitTest` then assembleDebug/Release.
Exit: that workflow green on this branch. No local gradle.

## G2 — single persistence source
Delete dual write. Runtime snapshot+history+TaskPackage: **one** store (`PersistenceManager` or migrate into encrypted store—pick one, migrate read fallback once).
`AgentService` resume + `MainActivity` hydrate + Resume button all read that store.
Exit: path-trace cold start loads same `pendingTaskPackage` Service would resume. No secret in that store if plain prefs; if TaskPackage stays plain, never put tokens in it (already true).

## G3 — resume/publish hardened path
- Interrupt at AwaitingApproval → process death → relaunch → Resume visible → resume → no new plan logs (`[C1.resume]` not `[C1] agent loop started` plan seed)
- Publish: branch exists / file commit / PR create failures → AgentFailed with package + retryable; second resume can finish
- Add C-logs already used: C0/C1/C1.resume/C3/C4/C5/E1/E3 — don't renumber casually
Exit: written E2E checklist in `docs/E2E-RESUME.md` with expected log greps; manual or instrumentation.

## G4 — release harden
- `isMinifyEnabled=true` + keep rules for app + coroutines
- signingConfig from env/`keystore.properties` example only (`*.jks` gitignored)
- `assembleRelease` smoke
Exit: release APK builds; mapping file noted.

## G5 — minimal Tool loop (only after G1–G3)
Implement 3 tools against GitHub API (IO thread): `list_tree`, `read_file`, `hash_edit` (EditGate snapshot→diff→apply→artifact).
Wire into AgentLoop as optional plan steps; every mutating tool requires checkpoint approval.
No local filesystem writes. No DNA full index unless already present as read-only helper.
Exit: one demo goal produces PR that edits a real repo file via hash_edit, not only `mobile-agent-output/*` draft.

## G6 — ADAPTIVE
Either real route (ask vs agent by heuristic) or remove mode from UI. No fake prefix.

Ship tag `mobile-agent-v0.1.0` only if G1–G5 green + README honest.

# File map (read on demand)
```
app-android/app/src/main/kotlin/ai/openchat/mobile/agent/
  MainActivity.kt          # UI, dispatch, observe failures
  AgentService.kt          # FG service, loopJob, IO, failure emit
  AppRuntimeState.kt       # reducer + recovery invariants
  AppSettingsStore.kt      # encrypted secrets; scrub external
  TaskPackage.kt
  core/agent/AgentLoop.kt  # plan/preview/publish/resume
  core/agent/AgentStatusHub.kt
  core/editgate/EditGate.kt
  core/github/GitHubClient.kt
  core/github/GitHubDiscovery.kt
  core/modelrouter/* 
  core/persistence/PersistenceManager.kt  # plain prefs runtime
  core/tools/Tool.kt       # empty interface
app/build.gradle.kts       # versionName 0.1.0-alpha
```

# Method each gate
1. 3-bullet plan
2. Read ≤3 files
3. Minimal patch
4. commit → ask push → CI workflow verifies (never local gradle)
5. 3-check + `可以推吗?` wait
6. After push: poll CI; red → fix; green → next gate

# Definition of done (prod)
- [ ] G1 tests cover L3/L4/L6/single-flight
- [ ] one persistence source; Service resume == UI
- [ ] E2E resume checklist proven (logs)
- [ ] release minify APK
- [ ] no secret outside encrypted settings
- [ ] mutating path always checkpoint + EditGate
- [ ] README = reality (alpha limitations listed)

# Anti-goals
Full IDE · background auto-publish · cleartext · user CA trust · multi-agent · bridge ports · silent plan regen · huge refactors

Start G1 now. First message: 3-bullet plan then code.
END
