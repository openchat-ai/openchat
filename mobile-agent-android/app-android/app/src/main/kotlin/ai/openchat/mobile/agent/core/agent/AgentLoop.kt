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
// - run() requires a non-blank goal and seeds a deterministic draft->publish queue for that goal

class AgentLoop(
    private val goalProvider: () -> String = { "Demo goal" },
    private val planRequest: suspend (ModelRequest) -> ModelResponse = { request ->
        ScriptedProvider().ask(request)
    },
    private val publishDraft: suspend (goal: String, draft: String) -> String = { _, _ ->
        "publish unavailable"
    },
) {

    private sealed interface AgentTask {
        data class PreviewDraft(val goal: String, val draft: String) : AgentTask
        data class PublishDraft(val goal: String, val draft: String) : AgentTask
        data class Summarize(val text: String) : AgentTask
    }

    private val _state = MutableStateFlow(AgentState.IDLE)
    val state: StateFlow<AgentState> = _state.asStateFlow()

    private val _log = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val log: SharedFlow<String> = _log.asSharedFlow()

    private val approvalChannel = Channel<Boolean>(capacity = 1)
    private val taskQueue = ArrayDeque<AgentTask>()
    private val editGate = EditGate()

    suspend fun run() {
        if (_state.value != AgentState.IDLE) {
            emit("[C0] run ignored: agent already active")
            return
        }

        val goal = goalProvider().trim()
        if (goal.isBlank()) {
            emit("[E0] agent goal is blank")
            return
        }

        taskQueue.clear()
        _state.value = AgentState.RUNNING
        emit("[C1] agent loop started: $goal")
        try {
            while (true) {
                val task = nextTask(goal) ?: break
                emit("[C2] task: ${describeTask(task)}")
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

    private suspend fun nextTask(goal: String): AgentTask? {
        if (taskQueue.isEmpty()) {
            val response = planRequest(
                ModelRequest(prompt = "Create a concise markdown implementation draft for this mobile coding goal: $goal")
            )
            if (!response.isSuccess) {
                emit("[E1] unable to create plan: ${response.error}")
                return null
            }

            val draft = response.text?.trim().orEmpty()
            if (draft.isBlank()) {
                emit("[E1.1] generated draft was empty")
                return null
            }

            taskQueue.addLast(AgentTask.PreviewDraft(goal, draft))
            taskQueue.addLast(AgentTask.PublishDraft(goal, draft))
            taskQueue.addLast(AgentTask.Summarize("agent draft pipeline complete for: $goal"))
            emit("[C1.1] seeded ${taskQueue.size} execution steps")
        }

        return taskQueue.removeFirstOrNull()
    }

    private suspend fun executeTask(task: AgentTask) {
        when (task) {
            is AgentTask.PreviewDraft -> runEditGatePreview(task.goal, task.draft)
            is AgentTask.PublishDraft -> runPublishDraft(task.goal, task.draft)
            is AgentTask.Summarize -> emit(task.text)
        }
    }

    private suspend fun emit(msg: String) {
        _log.emit(msg)
    }

    private suspend fun runEditGatePreview(goal: String, draft: String) {
        val path = "mobile-agent-output/${slugify(goal)}.md"
        val original = "# Agent Draft\n"
        val proposed = draft.ensureHeading(goal)
        val snapshot = editGate.snapshot(path = path, content = original)
        val diff = editGate.diff(snapshot, proposed)
        emit("[C5.1] diff preview\n$diff")
        val applied = editGate.apply(snapshot, proposed).getOrElse { error ->
            emit("[E2] edit gate rejected: ${error.message}")
            return
        }
        emit("[C5.2] edit gate accepted ${applied.lines().size} lines")
    }

    private suspend fun runPublishDraft(goal: String, draft: String) {
        val result = runCatching {
            publishDraft(goal, draft.ensureHeading(goal))
        }.getOrElse { error ->
            emit("[E3] publish failed: ${error.message}")
            return
        }
        emit("[C5.3] $result")
    }

    private fun describeTask(task: AgentTask): String = when (task) {
        is AgentTask.PreviewDraft -> "preview draft for ${task.goal}"
        is AgentTask.PublishDraft -> "publish draft PR for ${task.goal}"
        is AgentTask.Summarize -> task.text
    }

    private fun slugify(value: String): String =
        value.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifBlank { "agent-task" }

    private fun String.ensureHeading(goal: String): String =
        if (startsWith("#")) this else "# $goal\n\n$this"

    class ScriptedProvider : ModelProvider {
        override val id: String = "scripted-offline"

        override suspend fun ask(request: ModelRequest): ModelResponse {
            val draft = listOf(
                "## Goal",
                request.prompt,
                "",
                "## Proposed Steps",
                "- inspect the target repository state",
                "- generate a first-pass implementation draft",
                "- open a review PR after approval",
            )
            return ModelResponse(text = draft.joinToString(separator = "\n"))
        }
    }
}
