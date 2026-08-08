# Cursor Development Prompt: Resume Agent P0

You are a coding agent working in the OpenChat Android app repository.

## Primary Goal
Finish the Agent resume path for the Android app so a user can interrupt the app, relaunch it, see the saved TaskPackage/checkpoint summary, and explicitly resume execution from the saved checkpoint without creating a new plan.

## Read First
Before editing code, read these files in this order:
1. `mobile-agent-android/docs/P0-RESUME-HANDOFF.md`
2. `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/AppRuntimeState.kt`
3. `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/TaskPackage.kt`
4. `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/AppSettingsStore.kt`
5. `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/core/agent/AgentLoop.kt`
6. `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/MainActivity.kt`
7. `mobile-agent-android/app-android/app/src/main/res/layout/activity_main.xml`
8. `mobile-agent-android/app-android/app/src/main/res/values/strings.xml`

## What Already Exists
- Reducer-based runtime state is already in place.
- Runtime persistence snapshot is already saved/restored.
- TaskPackage, Artifact, Checkpoint, PublishIntent already exist.
- Agent lifecycle events already carry TaskPackage and checkpoint context.
- The Agent panel already shows a structured recovery summary.
- A `Resume` button was started in the layout, but the flow is incomplete.

## What You Must Implement
1. Wire the `Resume` button in `MainActivity`.
2. Add a `resumeAgent()` entry point.
3. Extend `AgentLoop` with an explicit resume API.
4. Use the saved `TaskPackage` and `lastCheckpointId` when resuming.
5. Do not re-run planning when a saved task package exists.
6. Ensure the resume path continues from the saved checkpoint or the next valid checkpoint.
7. Clear recovery state on successful completion.
8. Preserve recovery state on recoverable failure.
9. Keep the UI honest: the user must see whether the app is ready to resume, currently running, or completed.

## Important Rules
- Do not replace the saved task package with a newly generated one during resume.
- Do not silently auto-resume on launch. Resumption must be explicit.
- Keep the change narrow. Do not redesign unrelated screens or flows.
- Preserve existing Ask behavior unless the change is required for shared recovery state.
- Keep TaskPackage as the source of truth for preview/publish intent.
- Keep PublishIntent as the source of truth for GitHub branch/commit/PR values.
- If you touch runtime state, update the reducer and persistence together.

## Implementation Hints
- `AgentSessionState` should represent resumed states using the persisted task package.
- `RecoveryState` should remain the source for saved prompt/goal/task package/checkpoint.
- `AgentLoop` should support a resume mode that builds its queue from the saved TaskPackage.
- A saved `lastCheckpointId` should determine where the resumed loop starts.
- If the checkpoint is missing or stale, fall back to the first valid checkpoint in the saved task package.
- The resume path should not regenerate planning output unless there is no saved task package.

## Files Likely to Change
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/MainActivity.kt`
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/AppRuntimeState.kt`
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/core/agent/AgentLoop.kt`
- `mobile-agent-android/app-android/app/src/main/res/layout/activity_main.xml`
- `mobile-agent-android/app-android/app/src/main/res/values/strings.xml`
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/AppSettingsStore.kt` if persistence needs adjustment

## Validation Steps
After implementing the change, run:
1. `export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 && ./gradlew :app:assembleDebug`

Then verify manually by reasoning through this scenario:
1. Start an Agent run.
2. Reach a checkpoint.
3. Simulate interruption or relaunch.
4. Confirm the recovery summary shows the saved task package and checkpoint.
5. Press `Resume`.
6. Confirm execution continues from the saved checkpoint and does not create a new plan.

## Definition of Done
- The Resume button is visible and functional.
- The app can resume from a persisted TaskPackage and checkpoint.
- The task package is not regenerated on resume.
- The build passes.
- Recovery state is cleaned up correctly after success.

## If You Get Stuck
If the current model is too weak to complete the full resume path safely:
1. Make the smallest safe change that wires the button and exposes the saved resume data.
2. Stop before inventing a fragile resume implementation.
3. Write the next missing step clearly in `mobile-agent-android/docs/P0-RESUME-HANDOFF.md`.

## Output Expectations
When you finish, report:
1. What files changed.
2. What the resume path now does.
3. Whether the build passed.
4. Any remaining risk or missing edge case.
