package ai.openchat.mobile.agent

// === invariants ===
// - askHistory maintains user/assistant turn sequence
// - agent state reflects current autonomous loop status
// - recovery state contains data for resuming interrupted tasks

data class AppRuntimeState(
    val mode: RuntimeMode = RuntimeMode.ASK,
    val askHistory: List<AskTurn> = emptyList(),
    val ask: AskSessionState = AskSessionState.Idle,
    val agent: AgentSessionState = AgentSessionState.Idle,
    val settings: SettingsState = SettingsState(),
    val recovery: RecoveryState = RecoveryState(),
    val lastError: AppError? = null,
)

data class RuntimePersistenceSnapshot(
    val mode: RuntimeMode,
    val recovery: RecoveryState,
    val lastError: AppError?,
)

sealed interface RuntimeAction {
    data class HydrateAskHistory(val history: List<AskTurn>) : RuntimeAction
    data class HydratePersistence(val snapshot: RuntimePersistenceSnapshot) : RuntimeAction
    data class SwitchMode(val mode: RuntimeMode) : RuntimeAction
    data class UpdateSettings(
        val providerReady: Boolean,
        val githubReady: Boolean,
    ) : RuntimeAction
    data class AskStarted(
        val prompt: String,
        val startedAtMs: Long,
    ) : RuntimeAction
    data class AskDelta(val delta: String) : RuntimeAction
    data class AskCompleted(
        val completedAtMs: Long,
        val response: String,
    ) : RuntimeAction
    data class AskFailed(
        val error: AppError,
        val preservePrompt: String,
    ) : RuntimeAction
    data class AskCancelled(
        val prompt: String,
    ) : RuntimeAction
    data object ClearAskHistory : RuntimeAction
    data class ObserveAgent(
        val state: AgentSessionState,
    ) : RuntimeAction
    data class AgentFailed(
        val error: AppError,
        val goal: String,
        val taskPackage: TaskPackage? = null,
        val checkpointId: String? = null,
    ) : RuntimeAction
    data class ClearRecovery(
        val keepError: Boolean = false,
    ) : RuntimeAction
}

fun AppRuntimeState.reduce(action: RuntimeAction): AppRuntimeState = when (action) {
    is RuntimeAction.HydrateAskHistory -> copy(
        askHistory = action.history,
        ask = if (action.history.isEmpty()) AskSessionState.Idle else AskSessionState.Completed(
            lastCompletedAtMs = 0L,
        ),
    )

    is RuntimeAction.HydratePersistence -> copy(
        mode = action.snapshot.mode,
        ask = AskSessionState.Idle,
        agent = AgentSessionState.Idle,
        recovery = action.snapshot.recovery,
        lastError = action.snapshot.lastError,
    )

    is RuntimeAction.SwitchMode -> copy(mode = action.mode)

    is RuntimeAction.UpdateSettings -> copy(
        settings = SettingsState(
            providerReady = action.providerReady,
            githubReady = action.githubReady,
        )
    )

    is RuntimeAction.AskStarted -> copy(
        askHistory = trimAskHistory(
            askHistory + AskTurn(role = "You", content = action.prompt) +
                AskTurn(role = "Assistant", content = "")
        ),
        ask = AskSessionState.Streaming(
            prompt = action.prompt,
            partialResponse = "",
            startedAtMs = action.startedAtMs,
        ),
        recovery = recovery.copy(
            needsResume = false,
            pendingAskPrompt = null,
            lastRecoveryMessage = null,
        ),
        lastError = null,
    )

    is RuntimeAction.AskDelta -> {
        val updatedHistory = askHistory.appendAssistantDelta(action.delta)
        copy(
            askHistory = updatedHistory,
            ask = (ask as? AskSessionState.Streaming)?.copy(
                partialResponse = updatedHistory.lastOrNull()?.content.orEmpty(),
            ) ?: ask,
        )
    }

    is RuntimeAction.AskCompleted -> copy(
        askHistory = askHistory.sealAssistantResponse(action.response),
        ask = AskSessionState.Completed(lastCompletedAtMs = action.completedAtMs),
        recovery = RecoveryState(),
    )

    is RuntimeAction.AskFailed -> copy(
        askHistory = askHistory.removeTrailingEmptyAssistant() + AskTurn(
            role = "System",
            content = action.error.message,
        ),
        ask = AskSessionState.Idle,
        settings = settings.copy(
            providerReady = if (action.error.kind == ErrorKind.ProviderAuth) false else settings.providerReady,
        ),
        recovery = RecoveryState(
            needsResume = true,
            pendingAskPrompt = action.preservePrompt,
            lastRecoveryMessage = action.error.message,
        ),
        lastError = action.error,
    )

    is RuntimeAction.AskCancelled -> copy(
        askHistory = askHistory.removeTrailingEmptyAssistant(),
        ask = AskSessionState.Idle,
        recovery = RecoveryState(
            needsResume = true,
            pendingAskPrompt = action.prompt,
            lastRecoveryMessage = "Ask request interrupted",
        ),
        lastError = null,
    )

    RuntimeAction.ClearAskHistory -> copy(
        askHistory = emptyList(),
        ask = AskSessionState.Idle,
        recovery = recovery.copy(
            needsResume = false,
            pendingAskPrompt = null,
            lastRecoveryMessage = null,
        ),
        lastError = null,
    )

    is RuntimeAction.ObserveAgent -> copy(
        agent = action.state,
        recovery = when (action.state) {
            AgentSessionState.Idle,
            is AgentSessionState.Completed -> RecoveryState()
            else -> recovery.copy(
                needsResume = false,
                pendingAgentGoal = action.state.goalOrNull(),
                pendingTaskPackage = action.state.taskPackageOrNull(),
                lastCheckpointId = action.state.checkpointIdOrNull(),
                lastRecoveryMessage = null,
            )
        },
        lastError = if (action.state is AgentSessionState.Completed) null else lastError,
    )

    is RuntimeAction.AgentFailed -> copy(
        agent = AgentSessionState.Idle,
        settings = settings.copy(
            githubReady = when (action.error.kind) {
                ErrorKind.GitHubAuth,
                ErrorKind.GitHubConflict,
                ErrorKind.GitHubRateLimit -> false
                else -> settings.githubReady
            },
        ),
        recovery = RecoveryState(
            needsResume = true,
            pendingAgentGoal = action.goal,
            pendingTaskPackage = action.taskPackage,
            lastCheckpointId = action.checkpointId,
            lastRecoveryMessage = action.error.message,
        ),
        lastError = action.error,
    )

    is RuntimeAction.ClearRecovery -> copy(
        recovery = RecoveryState(),
        lastError = if (action.keepError) lastError else null,
    )
}

private fun AgentSessionState.goalOrNull(): String? = when (this) {
    AgentSessionState.Idle -> null
    is AgentSessionState.Planning -> goal
    is AgentSessionState.AwaitingApproval -> taskPackage.goal
    is AgentSessionState.Executing -> taskPackage.goal
    is AgentSessionState.Publishing -> taskPackage.goal
    is AgentSessionState.Completed -> taskPackage.goal
}

private fun AgentSessionState.taskPackageOrNull(): TaskPackage? = when (this) {
    AgentSessionState.Idle,
    is AgentSessionState.Planning -> null
    is AgentSessionState.AwaitingApproval -> taskPackage
    is AgentSessionState.Executing -> taskPackage
    is AgentSessionState.Publishing -> taskPackage
    is AgentSessionState.Completed -> taskPackage
}

private fun AgentSessionState.checkpointIdOrNull(): String? = when (this) {
    AgentSessionState.Idle,
    is AgentSessionState.Planning,
    is AgentSessionState.Completed -> null
    is AgentSessionState.AwaitingApproval -> currentCheckpoint.id
    is AgentSessionState.Executing -> currentCheckpointId
    is AgentSessionState.Publishing -> currentCheckpointId
}

private fun List<AskTurn>.appendAssistantDelta(delta: String): List<AskTurn> {
    if (isEmpty()) return this
    val last = last()
    if (last.role != "Assistant") return this
    return toMutableList().apply {
        this[lastIndex] = last.copy(content = last.content + delta)
    }
}

private fun List<AskTurn>.sealAssistantResponse(response: String): List<AskTurn> {
    if (isEmpty()) {
        return listOf(AskTurn(role = "Assistant", content = response))
    }
    val last = last()
    return if (last.role == "Assistant") {
        toMutableList().apply {
            this[lastIndex] = last.copy(content = response)
        }
    } else {
        this + AskTurn(role = "Assistant", content = response)
    }
}

private fun List<AskTurn>.removeTrailingEmptyAssistant(): List<AskTurn> {
    val last = lastOrNull() ?: return this
    if (last.role != "Assistant" || last.content.isNotEmpty()) return this
    return dropLast(1)
}

private fun trimAskHistory(history: List<AskTurn>): List<AskTurn> =
    if (history.size <= 12) history else history.takeLast(12)

fun AppRuntimeState.toPersistenceSnapshot(): RuntimePersistenceSnapshot {
    val activeAskPrompt = (ask as? AskSessionState.Streaming)?.prompt
    val activeAgentGoal = agent.goalOrNull()
    val activeRecoveryMessage = when {
        ask is AskSessionState.Streaming -> "Ask request interrupted"
        activeAgentGoal != null && agent !is AgentSessionState.Completed -> "Agent execution interrupted"
        else -> recovery.lastRecoveryMessage
    }

    return RuntimePersistenceSnapshot(
        mode = mode,
        recovery = recovery.copy(
            needsResume = recovery.needsResume || activeAskPrompt != null || activeAgentGoal != null,
            pendingAskPrompt = activeAskPrompt ?: recovery.pendingAskPrompt,
            pendingAgentGoal = activeAgentGoal ?: recovery.pendingAgentGoal,
            pendingTaskPackage = agent.taskPackageOrNull() ?: recovery.pendingTaskPackage,
            lastCheckpointId = agent.checkpointIdOrNull() ?: recovery.lastCheckpointId,
            lastRecoveryMessage = activeRecoveryMessage,
        ),
        lastError = lastError,
    )
}

enum class RuntimeMode {
    ASK,
    PLAN,
    AGENT,
    ADAPTIVE,
}

sealed interface AskSessionState {
    data object Idle : AskSessionState
    data class Streaming(
        val prompt: String,
        val partialResponse: String,
        val startedAtMs: Long,
    ) : AskSessionState
    data class Completed(
        val lastCompletedAtMs: Long,
    ) : AskSessionState
}

sealed interface AgentSessionState {
    data object Idle : AgentSessionState
    data class Planning(
        val goal: String,
        val startedAtMs: Long,
    ) : AgentSessionState
    data class AwaitingApproval(
        val taskPackage: TaskPackage,
        val currentCheckpoint: Checkpoint,
    ) : AgentSessionState
    data class Executing(
        val taskPackage: TaskPackage,
        val currentCheckpointId: String?,
        val currentStepLabel: String,
    ) : AgentSessionState
    data class Publishing(
        val taskPackage: TaskPackage,
        val currentCheckpointId: String?,
    ) : AgentSessionState
    data class Completed(
        val taskPackage: TaskPackage,
        val summary: String,
    ) : AgentSessionState
}

data class SettingsState(
    val providerReady: Boolean = false,
    val githubReady: Boolean = false,
)

data class RecoveryState(
    val degradedMode: Boolean = false,
    val needsResume: Boolean = false,
    val pendingAskPrompt: String? = null,
    val pendingAgentGoal: String? = null,
    val pendingTaskPackage: TaskPackage? = null,
    val lastCheckpointId: String? = null,
    val lastRecoveryMessage: String? = null,
)

data class AppError(
    val kind: ErrorKind,
    val code: String,
    val message: String,
    val retryable: Boolean,
    val occurredAtMs: Long,
    val stateSnapshot: String,
)

enum class ErrorKind {
    Validation,
    ProviderAuth,
    ProviderTimeout,
    ProviderProtocol,
    GitHubAuth,
    GitHubConflict,
    GitHubRateLimit,
    Storage,
    Cancellation,
    Unknown,
}