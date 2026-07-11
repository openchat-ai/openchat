package ai.openchat.mobile.agent.core.agent

import ai.openchat.mobile.agent.AgentSessionState
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

object AgentStatusHub {
    private val _state = MutableStateFlow<AgentSessionState>(AgentSessionState.Idle)
    val state = _state.asStateFlow()

    private val _log = MutableSharedFlow<String>(replay = 100)
    val log = _log.asSharedFlow()

    fun updateState(newState: AgentSessionState) {
        _state.value = newState
    }

    suspend fun emitLog(message: String) {
        _log.emit(message)
    }

    // Channel for Activity -> Service commands (like approval)
    private val _commands = MutableSharedFlow<AgentCommand>()
    val commands = _commands.asSharedFlow()

    suspend fun sendCommand(command: AgentCommand) {
        _commands.emit(command)
    }
}

sealed interface AgentCommand {
    object Approve : AgentCommand
    object Reject : AgentCommand
    object Stop : AgentCommand
}
