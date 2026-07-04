package ai.openchat.mobile.agent.core.agent

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

// === invariants ===
// - _state transitions: IDLE → RUNNING → WAITING → RUNNING → IDLE
// - approvalChannel has capacity 1; second send before receive is dropped
// - run() is not re-entrant; caller must cancel previous job first

class AgentLoop {

    private val _state = MutableStateFlow(AgentState.IDLE)
    val state: StateFlow<AgentState> = _state.asStateFlow()

    private val _log = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val log: SharedFlow<String> = _log.asSharedFlow()

    private val approvalChannel = Channel<Boolean>(capacity = 1)

    suspend fun run() {
        _state.value = AgentState.RUNNING
        emit("[C1] agent loop started")
        try {
            while (true) {
                val task = nextTask() ?: break
                emit("[C2] task: $task")
                _state.value = AgentState.WAITING
                emit("[C3] awaiting human approval")
                val approved = approvalChannel.receive()
                if (!approved) {
                    emit("[C4] rejected, stopping")
                    break
                }
                _state.value = AgentState.RUNNING
                emit("[C5] approved, executing")
                executeTask(task)
            }
        } finally {
            _state.value = AgentState.IDLE
            emit("[C6] agent loop stopped")
        }
    }

    fun approve() {
        approvalChannel.trySend(true)
    }

    fun reject() {
        approvalChannel.trySend(false)
    }

    private fun nextTask(): String? = null // TODO: integrate ModelRouter

    private suspend fun executeTask(task: String) {
        emit("exec: $task")
    }

    private suspend fun emit(msg: String) {
        _log.emit(msg)
    }
}
