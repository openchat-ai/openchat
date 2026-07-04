package ai.openchat.mobile.agent.core.agent

import ai.openchat.mobile.agent.core.editgate.EditGate
import ai.openchat.mobile.agent.core.modelrouter.ModelProvider
import ai.openchat.mobile.agent.core.modelrouter.ModelRequest
import ai.openchat.mobile.agent.core.modelrouter.ModelResponse
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
// - run() seeds a deterministic offline plan when no provider is configured

class AgentLoop(
    private val planRequest: suspend (ModelRequest) -> ModelResponse = { request ->
        ScriptedProvider().ask(request)
    },
) {

    private val _state = MutableStateFlow(AgentState.IDLE)
    val state: StateFlow<AgentState> = _state.asStateFlow()

    private val _log = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val log: SharedFlow<String> = _log.asSharedFlow()

    private val approvalChannel = Channel<Boolean>(capacity = 1)
    private val taskQueue = ArrayDeque<String>()
    private val editGate = EditGate()

    suspend fun run() {
        if (_state.value != AgentState.IDLE) {
            emit("[C0] run ignored: agent already active")
            return
        }

        taskQueue.clear()
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
            emit("[C7] plan complete")
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

    private suspend fun nextTask(): String? {
        if (taskQueue.isEmpty()) {
            val response = planRequest(
                ModelRequest(prompt = "Create a short offline Android agent demo plan")
            )
            if (!response.isSuccess) {
                emit("[E1] unable to create plan: ${response.error}")
                return null
            }

            response.text
                ?.lineSequence()
                ?.map { it.trim() }
                ?.filter { it.isNotEmpty() }
                ?.forEach(taskQueue::addLast)

            emit("[C1.1] seeded ${taskQueue.size} planned steps")
        }

        return taskQueue.removeFirstOrNull()
    }

    private suspend fun executeTask(task: String) {
        when {
            task.startsWith("preview edit gate:") -> runEditGatePreview(task)
            task.startsWith("summarize:") -> emit(task.removePrefix("summarize:").trim())
            else -> emit("exec: $task")
        }
    }

    private suspend fun emit(msg: String) {
        _log.emit(msg)
    }

    private suspend fun runEditGatePreview(task: String) {
        val path = "demo/AgentPlan.md"
        val original = "# Agent Plan\n- Inspect branch status\n"
        val proposed = "$original- ${task.removePrefix("preview edit gate:").trim()}\n"
        val snapshot = editGate.snapshot(path = path, content = original)
        val diff = editGate.diff(snapshot, proposed)
        emit("[C5.1] diff preview\n$diff")
        val applied = editGate.apply(snapshot, proposed).getOrElse { error ->
            emit("[E2] edit gate rejected: ${error.message}")
            return
        }
        emit("[C5.2] edit gate accepted ${applied.lines().size} lines")
    }

    class ScriptedProvider : ModelProvider {
        override val id: String = "scripted-offline"

        override suspend fun ask(request: ModelRequest): ModelResponse {
            val plan = listOf(
                "inspect workspace state",
                "preview edit gate: add approval trace checkpoint",
                "summarize: offline agent demo complete; GitHub/network tools remain stubbed",
            )
            return ModelResponse(text = plan.joinToString(separator = "\n"))
        }
    }
}
