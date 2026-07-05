# P0 Resume Handoff (2026-07-04)

## Goal
Make Agent mode resumable after interruption, with TaskPackage + checkpoint persisted and visible, and continue execution from saved checkpoint.

## Completed
- Reducer-based runtime state is active.
- Typed recoverable errors are active for Ask/Agent.
- Runtime persistence snapshot is saved and restored.
- TaskPackage model is introduced and wired into runtime state and persistence.
- Agent lifecycle emits structured events carrying task package/checkpoint context.
- Agent panel shows a structured recovery summary (goal/checkpoint/publish intent/rollback hint).
- Android debug build verified after the above changes.

## In Progress
- Explicit Resume execution path is partially started:
  - `btnResume` has been added to layout and strings.
  - Execution flow is NOT fully wired yet.

## Next Steps (cheap-model checklist)
1. Wire `btnResume` in `MainActivity` and add a `resumeAgent()` entry.
2. Extend `AgentLoop` with resume API, for example:
   - `suspend fun resume(taskPackage: TaskPackage, fromCheckpointId: String?)`
   - Build task queue from saved task package and checkpoint.
3. Ensure resume path does NOT regenerate a new plan when a saved task package exists.
4. Update reducer actions/state transitions for resumed awaiting-approval/executing/publishing.
5. Clear recovery state on successful completion; preserve task package/checkpoint on recoverable failure.
6. Validate with one interruption scenario:
   - Start agent -> reach checkpoint -> simulate interruption -> relaunch -> resume -> finish publish.
7. Run build again:
   - `export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 && ./gradlew :app:assembleDebug`

## Key Files
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/AppRuntimeState.kt`
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/TaskPackage.kt`
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/AppSettingsStore.kt`
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/core/agent/AgentLoop.kt`
- `mobile-agent-android/app-android/app/src/main/kotlin/ai/openchat/mobile/agent/MainActivity.kt`
- `mobile-agent-android/app-android/app/src/main/res/layout/activity_main.xml`
- `mobile-agent-android/app-android/app/src/main/res/values/strings.xml`

## Known Risk
- If resume is wired incorrectly, flow may silently create a new task package instead of continuing saved one, which breaks checkpoint semantics.
