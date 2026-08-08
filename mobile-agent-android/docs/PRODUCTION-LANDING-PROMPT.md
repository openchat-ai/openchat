# PROMPT · mobile-agent-android → production
> Paste everything under `BEGIN` into a new session. Do not invent scope.

BEGIN
You ship `mobile-agent-android/` only on branch `mobile/android-agent-app-linear`.
Baseline tag: `mobile-agent-v0.1.0-alpha` @ `docs/v0.1.0-alpha-BASELINE.md`.
DNA+HASHLINE = architecture anchors (EditGate MD5-8 + ordered diff). Not a full experiment port. No bridge. No Flutter.

# Mission
Make the mobile agent **locally operate files, push to GitHub, poll CI**, all from phone.
Product is a mobile coding companion: Ask stream + Agent read/edit local files → git push → GitHub CI builds/tests → result back to user. Not a mobile IDE.

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
L9 LOCAL SANDBOX: Local tools (glob/edit/read/write/list/delete/bash) are sandboxed to `filesDir` only, never the app tree. GitHub tools (list_tree/read_file/hash_edit/ci_status/ci_log/git_*) hit GitHub API only. Sandbox boundary is a regression guard: local path must never escape `filesDir`; shell must not touch GitHub API.
L10 RELEASE: minify=true, signing from properties. `keystore.properties.example` committed; real `*.jks` + `keystore.properties` in gitignore. Don't commit real secrets.

# Gate order (finish & verify each before next)
## ✅ G1–G6 (complete, code delivered)
- G1: unit tests for landmines (L3/L4/L6/single-flight) + CI green
- G2: single persistence source (PersistenceManager)
- G3: resume/publish hardened path + E2E checklist
- G4: release minify + signing config + APK built
- G5: GitHub API tools (list_tree/read_file/hash_edit) wired in AgentLoop
- G6: ADAPTIVE routing via keyword heuristic

## G7 — local file read/write tools (phone local)
Add tools that operate on `context.filesDir` (app private directory):
- `read_local_file(path)` — read file from app sandbox
- `write_local_file(path, content)` — write to app sandbox
- `list_local_dir(path)` — list files in sandbox directory
- `delete_local_file(path)` — remove file
All on `Dispatchers.IO`. Wire into ToolRegistry. Approval required for mutating ops.
Exit: Agent can read a file from local storage and write a modified version.

## G8 — git init/add/commit/push from phone
Wire JGit or shell `Process.exec("git ...")` inside app sandbox:
- `git_init(repoUrl)` — clone or init
- `git_add(paths)` — stage files
- `git_commit(message)` — commit
- `git_push()` — push to GitHub (use stored token)
No credential in logs. Push needs approval checkpoint.
Exit: Agent edits local file, commits, pushes → change appears on GitHub.

## G9 — CI status poll
- `ci_status(owner, repo, runId?)` — poll GitHub Actions workflow via API
- Parse conclusion (success/failure/cancelled) + failed job names
- Feed result back to LLM for fix loop
Exit: Agent pushes code → polls CI → retries on failure (loop within TaskPackage).

## G10 — end-to-end fix loop
Goal: "fix the CI failure in X" → read CI log → read local file → edit → push → poll CI → repeat until green.
- Max retries = 3 per checkpoint to avoid infinite loop
- Human approval required at each push
Exit: one human command results in a CI-green PR, with Agent iterating automatically.

Ship tag `mobile-agent-v0.1.0` only after G7–G10 green + README honest.

# File map (read on demand)
```
app-android/app/src/main/kotlin/ai/openchat/mobile/agent/
  MainActivity.kt          # UI, dispatch, observe failures
  AgentService.kt          # FG service, loopJob, IO, failure emit
  AppRuntimeState.kt       # reducer + recovery invariants
  AppSettingsStore.kt      # encrypted secrets
  TaskPackage.kt
  core/agent/AgentLoop.kt  # plan/preview/publish/resume/tools
  core/agent/AgentStatusHub.kt
  core/editgate/EditGate.kt       # MD5-8 hash + LCS diff
  core/github/GitHubClient.kt     # HTTP GitHub API client
  core/github/GitHubDiscovery.kt  # owners/repos/branches/tree listing
  core/modelrouter/*
  core/persistence/PersistenceManager.kt
  core/tools/Tool.kt              # interface
  core/tools/ToolRegistry.kt      # register/lookup tools
  core/tools/GitHubTool.kt        # list_tree/read_file/hash_edit
app/build.gradle.kts
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
- [ ] G2–G6 delivered: single persist, resume E2E, release APK, GitHub tools, ADAPTIVE
- [ ] G7: local file read/write tools
- [ ] G8: git init/add/commit/push from phone
- [ ] G9: CI status poll via GitHub API
- [ ] G10: end-to-end fix loop (read CI → edit local → push → poll → repeat)
- [ ] no secret outside encrypted settings
- [ ] mutating path always checkpoint + EditGate
- [ ] README = reality (alpha limitations listed)

# Anti-goals
Full IDE · background auto-publish · cleartext · user CA trust · multi-agent · bridge ports · silent plan regen · huge refactors · local compilation/testing on phone

Start G7 now. First message: 3-bullet plan then code.
END
