package ai.openchat.mobile.agent.core.agent

import ai.openchat.mobile.agent.AgentSessionState
import ai.openchat.mobile.agent.TaskPackage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

// === invariants ===
// - state is the live agent session mirror for UI
// - failures are one-shot events; UI maps them to RuntimeAction.AgentFailed
// - commands are Activity -> Service only

object AgentStatusHub {
    private val _state = MutableStateFlow<AgentSessionState>(AgentSessionState.Idle)
    val state = _state.asStateFlow()

    private val _log = MutableSharedFlow<String>(replay = 100)
    val log = _log.asSharedFlow()

    private val _failures = MutableSharedFlow<AgentFailure>(extraBufferCapacity = 8)
    val failures = _failures.asSharedFlow()

    fun updateState(newState: AgentSessionState) {
        _state.value = newState
    }

    suspend fun emitLog(message: String) {
        _log.emit(message)
    }

    suspend fun reportFailure(failure: AgentFailure) {
        _failures.emit(failure)
    }

    private val _commands = MutableSharedFlow<AgentCommand>(extraBufferCapacity = 8)
    val commands = _commands.asSharedFlow()

    suspend fun sendCommand(command: AgentCommand) {
        _commands.emit(command)
    }
}

data class AgentFailure(
    val goal: String,
    val stage: String,
    val message: String,
    val retryable: Boolean,
    val cancelled: Boolean = false,
    val taskPackage: TaskPackage? = null,
    val checkpointId: String? = null,
)

sealed interface AgentCommand {
    data object Approve : AgentCommand
    data object Reject : AgentCommand
    data object Stop : AgentCommand
}
