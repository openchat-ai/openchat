package ai.openchat.mobile.agent.core.agent

import ai.openchat.mobile.agent.Artifact
import ai.openchat.mobile.agent.ArtifactKind
import ai.openchat.mobile.agent.Checkpoint
import ai.openchat.mobile.agent.PublishIntent
import ai.openchat.mobile.agent.TaskPackage
import ai.openchat.mobile.agent.core.editgate.EditGate
import ai.openchat.mobile.agent.core.modelrouter.ModelProvider
import ai.openchat.mobile.agent.core.modelrouter.ModelRequest
import ai.openchat.mobile.agent.core.persistence.PersistenceManager
import ai.openchat.mobile.agent.core.modelrouter.ModelResponse
import ai.openchat.mobile.agent.core.tools.ToolRegistry
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

sealed interface AgentLifecycleEvent {
    data class Planning(val goal: String) : AgentLifecycleEvent
    data class AwaitingApproval(
        val taskPackage: TaskPackage,
        val currentCheckpoint: Checkpoint,
    ) : AgentLifecycleEvent
    data class Executing(
        val taskPackage: TaskPackage,
        val currentCheckpointId: String?,
        val stepLabel: String,
    ) : AgentLifecycleEvent
    data class Publishing(
        val taskPackage: TaskPackage,
        val currentCheckpointId: String?,
    ) : AgentLifecycleEvent
    data class RoleResult(
        val role: AgentRole,
        val summary: String,
        val decision: RoleDecision,
    ) : AgentLifecycleEvent
    data class Completed(
        val taskPackage: TaskPackage,
        val summary: String,
    ) : AgentLifecycleEvent
    data class Failed(
        val goal: String,
        val stage: String,
        val message: String,
        val retryable: Boolean,
        val taskPackage: TaskPackage? = null,
        val checkpointId: String? = null,
    ) : AgentLifecycleEvent
    data class Cancelled(
        val goal: String,
        val taskPackage: TaskPackage? = null,
        val checkpointId: String? = null,
    ) : AgentLifecycleEvent
    object Idle : AgentLifecycleEvent
}

// === invariants ===
// - _state transitions: IDLE → RUNNING → WAITING → RUNNING → IDLE
// - approvalChannel has capacity 1; second send before receive is dropped
// - Role sequence: Sentinel → Explorer → Orchestrator → [Worker → Reviewer → Critic → Auditor] × iterations ≤ maxIterations
// - When Auditor rejects: clear workerOutput → rerun Worker with review/critic/audit feedback
// - Worker steps with tool calls require human approval; analysis roles auto-proceed

class AgentLoop(
    private val goalProvider: () -> String = { "Demo goal" },
    private val baseBranchProvider: () -> String = { "main" },
    private val stopAfterPlanningProvider: () -> Boolean = { false },
    private val maxPlanningRounds: Int = 3,
    private val maxIterations: Int = 3,
    private val planRequest: suspend (ModelRequest) -> ModelResponse = { request ->
        ScriptedProvider().ask(request)
    },
    private val streamRequest: suspend (ModelRequest, onDelta: suspend (String) -> Unit) -> ModelResponse = { request, _ ->
        planRequest(request)
    },
    private val publishDraft: suspend (taskPackage: TaskPackage) -> String = { _ ->
        "publish unavailable"
    },
    private val onLifecycleEvent: suspend (AgentLifecycleEvent) -> Unit = {},
    private val repoContext: suspend () -> String = { "" },
    private val toolRegistry: ToolRegistry = ToolRegistry(),
    private val handoffDir: File = File(System.getProperty("java.io.tmpdir", "/tmp"), "agent-handoffs"),
    private val emitBeforeTool: (String) -> Unit = {},
    private val emitAfterTool: (String, String) -> Unit = { _, _ -> },
    private val onMemorySave: suspend (String, RoleContext, TaskPackage?, Int, String?) -> Unit = { _, _, _, _, _ -> },
    private val onMemoryLoad: () -> RoleContext? = { null },
) {

    private enum class ArtifactFormat {
        MARKDOWN,
        JSON,
        KOTLIN,
    }

    private data class DraftArtifact(
        val path: String,
        val content: String,
        val format: ArtifactFormat,
    )

    private sealed interface AgentTask {
        val taskPackage: TaskPackage
        val checkpoint: Checkpoint?

        data class PreviewDraft(
            override val taskPackage: TaskPackage,
            override val checkpoint: Checkpoint,
        ) : AgentTask

        data class PublishDraft(
            override val taskPackage: TaskPackage,
            override val checkpoint: Checkpoint,
        ) : AgentTask

        data class ToolCall(
            override val taskPackage: TaskPackage,
            override val checkpoint: Checkpoint,
            val toolName: String,
            val toolArgs: Map<String, String>,
        ) : AgentTask

        data class Summarize(
            override val taskPackage: TaskPackage,
            val text: String,
        ) : AgentTask {
            override val checkpoint: Checkpoint? = null
        }

        data class WorkerVerify(
            override val taskPackage: TaskPackage,
            val requiredToolNames: List<String>,
        ) : AgentTask {
            override val checkpoint: Checkpoint? = null
        }
    }

    private val _state = MutableStateFlow(AgentState.IDLE)
    val state: StateFlow<AgentState> = _state.asStateFlow()

    private val _log = MutableSharedFlow<String>(
        replay = 64,
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )
    val log: SharedFlow<String> = _log.asSharedFlow()

    private var approvalChannel = Channel<Boolean>(capacity = 1)
    private val taskQueue = ArrayDeque<AgentTask>()
    private val editGate = EditGate()
    private var shouldStop = false
    private var cancelled = false
    private var latestTaskPackage: TaskPackage? = null
    private var _resumeOnly = false
    private var _milestoneRounds = 0
    private var _iterationRounds = 0
    private val toolOutputs = mutableMapOf<String, String>()
    private val retryCounts = mutableMapOf<String, Int>()
    private val maxTaskRetries = 3

    private val orchestrator = RoleOrchestrator()
    private val handoff = ContextHandoff(handoffDir)
    private var roleContext = RoleContext(goal = "")
    private val saveMemory: suspend (String, RoleContext, TaskPackage?, Int, String?) -> Unit = { phase, ctx, tp, idx, cp ->
        onMemorySave(phase, ctx, tp, idx, cp)
    }

    private suspend fun askWithStream(roleLabel: String, prompt: String): ModelResponse {
        return streamRequest(ModelRequest(prompt = prompt)) { delta ->
            AgentStatusHub.emitStream(roleLabel, delta)
            emit("[STREAM:$roleLabel]$delta")
        }
    }

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
        shouldStop = false
        cancelled = false
        latestTaskPackage = null
        approvalChannel = Channel<Boolean>(capacity = 1)
        _milestoneRounds = 0
        _state.value = AgentState.RUNNING
        onLifecycleEvent(AgentLifecycleEvent.Planning(goal))
        emit("[C1] multi-role agent started: $goal")
        val scannedRepo = runCatching { repoContext() }.getOrElse { "Workspace unavailable: $it" }
        val restoredContext = onMemoryLoad()
        roleContext = RoleContext(
            goal = goal,
            repoContext = scannedRepo,
            sentinelSummary = restoredContext?.sentinelSummary ?: "",
            explorationResult = restoredContext?.explorationResult ?: "",
            milestonePlan = restoredContext?.milestonePlan ?: "",
            workerOutput = restoredContext?.workerOutput ?: "",
            reviewResult = restoredContext?.reviewResult ?: "",
            criticResult = restoredContext?.criticResult ?: "",
            auditorResult = restoredContext?.auditorResult ?: "",
        )
        handoff.clearHandoffs()
        runRoleLoop(goal)
    }

    suspend fun resume(taskPackage: TaskPackage, fromCheckpointId: String?) {
        if (_state.value != AgentState.IDLE) {
            emit("[C0] resume ignored: agent already active")
            return
        }
        val goal = taskPackage.goal
        taskQueue.clear()
        shouldStop = false
        cancelled = false
        latestTaskPackage = taskPackage
        approvalChannel = Channel<Boolean>(capacity = 1)
        _state.value = AgentState.RUNNING
        val checkpointIndex = taskPackage.checkpoints.indexOfFirst { it.id == fromCheckpointId }
        val startIndex = if (checkpointIndex >= 0) checkpointIndex else 0
        for (i in startIndex until taskPackage.checkpoints.size) {
            val cp = taskPackage.checkpoints[i]
            when (cp.id) {
                CHECKPOINT_PREVIEW -> taskQueue.addLast(AgentTask.PreviewDraft(taskPackage, cp))
                CHECKPOINT_PUBLISH -> taskQueue.addLast(AgentTask.PublishDraft(taskPackage, cp))
                else -> taskQueue.addLast(AgentTask.PreviewDraft(taskPackage, cp))
            }
        }
        taskQueue.addLast(AgentTask.Summarize(taskPackage, "agent pipeline complete for: $goal"))
        emit("[C1.resume] resumed from ${fromCheckpointId ?: "start"}: ${taskQueue.size} steps")
        _resumeOnly = true
        val scannedRepo = runCatching { repoContext() }.getOrElse { "Workspace unavailable: $it" }
        roleContext = roleContext.copy(goal = goal, repoContext = scannedRepo)
        runMainLoop(goal)
    }

    private suspend fun runRoleLoop(goal: String) {
        try {
            while (!orchestrator.isTerminalPhase(roleContext) && !shouldStop && !cancelled) {
                val role = orchestrator.next(roleContext)
                emit("[R] role=${role.label} phase=${orchestrator.milestoneProgress(roleContext).take(80)}")
                onLifecycleEvent(AgentLifecycleEvent.RoleResult(role, "starting", RoleDecision.Proceed))

                if (handoff.shouldHandoff(roleContext)) {
                    val path = handoff.writeHandoff(roleContext, Phase.valueOf(role.name))
                    emit("[H] context full: handoff written to $path")
                    val summary = handoff.handoffSummary(roleContext)
                    roleContext = roleContext.copy(
                        sentinelSummary = summary,
                        explorationResult = "",
                        milestonePlan = "",
                        workerOutput = "",
                        reviewResult = "",
                        criticResult = "",
                        auditorResult = "",
                    )
                    emit("[H] context reset; summary injected")
                }

                when (role) {
                    AgentRole.SENTINEL -> runSentinel(goal)
                    AgentRole.EXPLORER -> runExplorer(goal)
                    AgentRole.ORCHESTRATOR -> {
                        _iterationRounds = 0
                        runOrchestrator(goal)
                    }
                    AgentRole.WORKER -> {
                        _milestoneRounds++
                        if (_milestoneRounds > maxPlanningRounds) {
                            emit("[E6] max milestone rounds ($maxPlanningRounds) reached")
                            shouldStop = true
                            break
                        }
                        runWorker(goal)
                    }
                    AgentRole.REVIEWER -> runReviewer(goal)
                    AgentRole.CRITIC -> runCritic(goal)
                    AgentRole.AUDITOR -> runAuditor(goal)
                }

                if (orchestrator.isFailed(roleContext) && _iterationRounds < maxIterations) {
                    _iterationRounds++
                    roleContext = roleContext.copy(workerOutput = "")
                    emit("[I${_iterationRounds}] auditor rejected, retrying worker (iteration ${_iterationRounds}/$maxIterations)")
                    continue
                }
            }

            if (stopAfterPlanningProvider() && !shouldStop && !cancelled) {
                emit("[C1.2] plan-only mode: full audit complete, stopping")
                onLifecycleEvent(AgentLifecycleEvent.Completed(
                    taskPackage = latestTaskPackage ?: buildFallbackTaskPackage(goal),
                    summary = buildFinalSummary(goal),
                ))
                shouldStop = true
            } else if (orchestrator.isComplete(roleContext) && !shouldStop && !cancelled) {
                val completedPackage = latestTaskPackage ?: buildFallbackTaskPackage(goal)
                onLifecycleEvent(AgentLifecycleEvent.Completed(
                    taskPackage = completedPackage,
                    summary = buildFinalSummary(goal),
                ))
                emit("[C7] multi-role plan complete")
            } else if (!shouldStop && !cancelled && orchestrator.isFailed(roleContext)) {
                val auditVer = roleContext.auditorResult.take(100)
                onLifecycleEvent(AgentLifecycleEvent.Failed(
                    goal = goal, stage = "auditor",
                    message = "Auditor rejected after ${_iterationRounds} iteration(s): $auditVer",
                    retryable = true,
                    taskPackage = latestTaskPackage,
                ))
                emit("[E5] auditor rejected after ${_iterationRounds} iteration(s), stopping")
            }
        } catch (error: kotlinx.coroutines.CancellationException) {
            if (!cancelled) {
                cancelled = true
                onLifecycleEvent(AgentLifecycleEvent.Cancelled(goal = goal, taskPackage = latestTaskPackage))
                emit("[C4] cancelled by stop")
            }
            throw error
        } finally {
            _state.value = AgentState.IDLE
            _resumeOnly = false
            emit("[C6] agent loop stopped")
        }
    }

    private suspend fun runMainLoop(goal: String) {
        try {
            while (true) {
                val task = nextTask(goal) ?: break
                emit("[C2] task: ${describeTask(task)}")
                _state.value = AgentState.WAITING
                onLifecycleEvent(AgentLifecycleEvent.AwaitingApproval(
                    taskPackage = task.taskPackage,
                    currentCheckpoint = task.checkpoint ?: task.taskPackage.checkpoints.last(),
                ))
                emit("[C3] awaiting human approval")
                val approved = approvalChannel.receive()
                if (!approved) {
                    cancelled = true
                    onLifecycleEvent(AgentLifecycleEvent.Cancelled(
                        goal = goal, taskPackage = task.taskPackage, checkpointId = task.checkpoint?.id,
                    ))
                    emit("[C4] rejected, stopping")
                    break
                }
                _state.value = AgentState.RUNNING
                onLifecycleEvent(task.toExecutionEvent())
                emit("[C5] approved, executing")
                val checkpointId = task.checkpoint?.id
                val attempts = if (checkpointId != null) (retryCounts[checkpointId] ?: 0) + 1 else 1
                executeTask(task, attempts)
                if (shouldStop) {
                    if (checkpointId != null) {
                        if (attempts <= maxTaskRetries) {
                            retryCounts[checkpointId] = attempts
                            shouldStop = false
                            taskQueue.addLast(task)
                            emit("[C5.retry] checkpoint $checkpointId attempt $attempts/$maxTaskRetries")
                            continue
                        }
                        retryCounts.remove(checkpointId)
                        onLifecycleEvent(AgentLifecycleEvent.Failed(
                            goal = goal,
                            stage = "retry-exhausted",
                            message = "checkpoint $checkpointId failed after $maxTaskRetries attempts",
                            retryable = false,
                            taskPackage = task.taskPackage,
                            checkpointId = checkpointId,
                        ))
                        emit("[E5] checkpoint $checkpointId failed after $maxTaskRetries attempts")
                    }
                    break
                }
            }
            if (!shouldStop && !cancelled) {
                val completedPackage = latestTaskPackage ?: buildFallbackTaskPackage(goal)
                onLifecycleEvent(AgentLifecycleEvent.Completed(
                    taskPackage = completedPackage,
                    summary = "agent pipeline complete for: $goal",
                ))
                emit("[C7] plan complete")
            }
        } catch (error: kotlinx.coroutines.CancellationException) {
            if (!cancelled) {
                cancelled = true
                onLifecycleEvent(AgentLifecycleEvent.Cancelled(goal = goal, taskPackage = latestTaskPackage))
                emit("[C4] cancelled by stop")
            }
            throw error
        } finally {
            _state.value = AgentState.IDLE
            _resumeOnly = false
            emit("[C6] agent loop stopped")
        }
    }

    private suspend fun runSentinel(goal: String) {
        val prompt = RolePrompts.systemPrompt(AgentRole.SENTINEL, roleContext)
        val response = askWithStream("SENTINEL", prompt)
        if (!response.isSuccess) {
            shouldStop = true
            onLifecycleEvent(AgentLifecycleEvent.Failed(goal, "sentinel", response.error ?: "sentinel failed", retryable = true))
            emit("[E1] sentinel error: ${response.error}")
            return
        }
        val text = response.text?.trim().orEmpty()
        roleContext = orchestrator.onOutput(roleContext, RoleOutput(AgentRole.SENTINEL, text))
        saveMemory("SENTINEL", roleContext, latestTaskPackage, 0, null)
        emit("[R] sentinel: ${text.take(120)}")
    }

    private suspend fun runExplorer(goal: String) {
        if (!roleContext.sentinelSummary.contains("NEEDS_EXPLORATION: YES")) {
            roleContext = roleContext.copy(explorationResult = "(no exploration needed)")
            emit("[R] explorer skipped")
            return
        }
        val prompt = RolePrompts.systemPrompt(AgentRole.EXPLORER, roleContext)
        val response = askWithStream("EXPLORER", prompt)
        if (!response.isSuccess) {
            shouldStop = true
            onLifecycleEvent(AgentLifecycleEvent.Failed(goal, "explorer", response.error ?: "explorer failed", retryable = true))
            emit("[E1] explorer error: ${response.error}")
            return
        }
        val text = response.text?.trim().orEmpty()
        roleContext = orchestrator.onOutput(roleContext, RoleOutput(AgentRole.EXPLORER, text))
        saveMemory("EXPLORER", roleContext, latestTaskPackage, 0, null)
        emit("[R] explorer: ${text.take(120)}")
    }

    private suspend fun runOrchestrator(goal: String) {
        val prompt = RolePrompts.systemPrompt(AgentRole.ORCHESTRATOR, roleContext)
        val response = askWithStream("ORCH", prompt)
        if (!response.isSuccess) {
            shouldStop = true
            onLifecycleEvent(AgentLifecycleEvent.Failed(goal, "orchestrator", response.error ?: "orchestrator failed", retryable = true))
            emit("[E1] orchestrator error: ${response.error}")
            return
        }
        val text = response.text?.trim().orEmpty()
        roleContext = orchestrator.onOutput(roleContext, RoleOutput(AgentRole.ORCHESTRATOR, text))
        saveMemory("ORCHESTRATOR", roleContext, latestTaskPackage, 0, null)
        val milestoneCount = text.lines().count { it.trim().startsWith("MILESTONE") }
        roleContext = roleContext.copy(
            totalMilestones = maxOf(milestoneCount, 1),
        )
        emit("[R] orchestrator: $milestoneCount milestone(s)")
    }

    private suspend fun runWorker(goal: String) {
        val toolDescriptions = if (toolRegistry.hasTools()) toolRegistry.listDescriptions() else ""
        val prompt = RolePrompts.systemPrompt(AgentRole.WORKER, roleContext, toolDescriptions)
        val response = askWithStream("WORKER", prompt)
        if (!response.isSuccess) {
            shouldStop = true
            onLifecycleEvent(AgentLifecycleEvent.Failed(goal, "worker", response.error ?: "worker failed", retryable = true))
            emit("[E1] worker error: ${response.error}")
            return
        }
        val text = response.text?.trim().orEmpty()
        roleContext = orchestrator.onOutput(roleContext, RoleOutput(AgentRole.WORKER, text))
        saveMemory("WORKER", roleContext, latestTaskPackage, 0, null)

        val toolCalls = parseToolCalls(text)
        val context = repoContext()
        val artifactFormat = inferArtifactFormat(goal)
        if (toolCalls.isNotEmpty()) {
            toolOutputs.clear()
            val tp = buildToolTaskPackage(goal, toolCalls)
            latestTaskPackage = tp
            toolCalls.forEach { (toolName, args) ->
                val cp = Checkpoint(id = "tool-$toolName-${System.currentTimeMillis()}", label = "Run $toolName", reason = "Worker tool call: $toolName", artifactPaths = emptyList())
                taskQueue.addLast(AgentTask.ToolCall(taskPackage = tp, checkpoint = cp, toolName = toolName, toolArgs = args))
            }
            taskQueue.addLast(AgentTask.WorkerVerify(tp, toolCalls.map { it.first }))
            val previewCp = tp.checkpoints.first { it.id == CHECKPOINT_PREVIEW }
            val publishCp = tp.checkpoints.first { it.id == CHECKPOINT_PUBLISH }
            taskQueue.addLast(AgentTask.PreviewDraft(tp, previewCp))
            taskQueue.addLast(AgentTask.PublishDraft(tp, publishCp))
            taskQueue.addLast(AgentTask.Summarize(tp, "worker tool pipeline complete for: $goal"))
            emit("[R.worker] ${toolCalls.size} tool(s) queued")
            runMainLoop(goal)
        } else {
            val artifact = buildArtifact(goal, artifactFormat, text)
            if (artifact.content.isNotBlank()) {
                val tp = buildTaskPackage(goal, artifact)
                latestTaskPackage = tp
                val previewCp = tp.checkpoints.first { it.id == CHECKPOINT_PREVIEW }
                val publishCp = tp.checkpoints.first { it.id == CHECKPOINT_PUBLISH }
                taskQueue.addLast(AgentTask.PreviewDraft(tp, previewCp))
                taskQueue.addLast(AgentTask.PublishDraft(tp, publishCp))
                taskQueue.addLast(AgentTask.Summarize(tp, "worker draft complete for: $goal"))
                emit("[R.worker] draft queued for preview/publish")
                runMainLoop(goal)
            }
        }
    }

    private suspend fun runReviewer(goal: String) {
        val prompt = RolePrompts.systemPrompt(AgentRole.REVIEWER, roleContext)
        val response = askWithStream("REVIEW", prompt)
        val text = response.text?.trim().orEmpty()
        roleContext = orchestrator.onOutput(roleContext, RoleOutput(AgentRole.REVIEWER, text))
        saveMemory("REVIEWER", roleContext, latestTaskPackage, 0, null)
        emit("[R] reviewer: ${text.take(120)}")
    }

    private suspend fun runCritic(goal: String) {
        val prompt = RolePrompts.systemPrompt(AgentRole.CRITIC, roleContext)
        val response = askWithStream("CRITIC", prompt)
        val text = response.text?.trim().orEmpty()
        roleContext = orchestrator.onOutput(roleContext, RoleOutput(AgentRole.CRITIC, text))
        saveMemory("CRITIC", roleContext, latestTaskPackage, 0, null)
        emit("[R] critic: ${text.take(120)}")
    }

    private suspend fun runAuditor(goal: String) {
        val prompt = RolePrompts.systemPrompt(AgentRole.AUDITOR, roleContext)
        val response = askWithStream("AUDIT", prompt)
        val text = response.text?.trim().orEmpty()
        roleContext = orchestrator.onOutput(roleContext, RoleOutput(AgentRole.AUDITOR, text))
        saveMemory("AUDITOR", roleContext, latestTaskPackage, 0, null)
        emit("[R] auditor: ${text.take(120)}")
    }

    fun approve() {
        approvalChannel.trySend(true)
    }

    fun reject() {
        cancelled = true
        approvalChannel.trySend(false)
    }

    private suspend fun nextTask(goal: String): AgentTask? {
        if (taskQueue.isEmpty()) return null
        return taskQueue.removeFirstOrNull()
    }

    private suspend fun executeTask(task: AgentTask, attempts: Int) {
        when (task) {
            is AgentTask.PreviewDraft -> runEditGatePreview(task.taskPackage, task.checkpoint)
            is AgentTask.PublishDraft -> runPublishDraft(task.taskPackage, task.checkpoint, attempts)
            is AgentTask.ToolCall -> executeToolCall(task, attempts)
            is AgentTask.Summarize -> emit(task.text)
            is AgentTask.WorkerVerify -> verifyWorkerOutput(task)
        }
    }

    private suspend fun executeToolCall(task: AgentTask.ToolCall, attempts: Int) {
        val tool = toolRegistry.get(task.toolName)
        if (tool == null) {
            shouldStop = true
            if (attempts <= maxTaskRetries) {
                onLifecycleEvent(AgentLifecycleEvent.Failed(goal = task.taskPackage.goal, stage = "tool",
                    message = "unknown tool: ${task.toolName}", retryable = true,
                    taskPackage = task.taskPackage, checkpointId = task.checkpoint.id))
            }
            emit("[E4] unknown tool: ${task.toolName}")
            return
        }
        val result = tool.invoke(task.toolArgs)
        if (!result.isSuccess) {
            shouldStop = true
            if (attempts <= maxTaskRetries) {
                onLifecycleEvent(AgentLifecycleEvent.Failed(goal = task.taskPackage.goal, stage = "tool",
                    message = result.error ?: "tool ${task.toolName} failed", retryable = true,
                    taskPackage = task.taskPackage, checkpointId = task.checkpoint.id))
            }
            emit("[E4] tool ${task.toolName} failed: ${result.error}")
            return
        }
        emit("[C5.t] tool ${task.toolName} succeeded")
        toolOutputs[task.toolName] = result.output
    }

    private suspend fun emit(msg: String) {
        _log.emit(msg)
    }

    private suspend fun verifyWorkerOutput(task: AgentTask.WorkerVerify) {
        val missingOutputs = task.requiredToolNames.filter { name ->
            toolOutputs[name]?.isNotBlank() != true
        }
        if (missingOutputs.isNotEmpty()) {
            shouldStop = true
            onLifecycleEvent(AgentLifecycleEvent.Failed(goal = task.taskPackage.goal, stage = "worker-verify",
                message = "missing tool outputs: ${missingOutputs.joinToString(", ")}", retryable = false,
                taskPackage = task.taskPackage, checkpointId = null))
            emit("[V1] worker verify failed: missing outputs ${missingOutputs.joinToString(", ")}")
            return
        }
        val resolved = resolveArtifact(task.taskPackage)
        if (resolved.content.isBlank()) {
            shouldStop = true
            onLifecycleEvent(AgentLifecycleEvent.Failed(goal = task.taskPackage.goal, stage = "worker-verify",
                message = "resolved artifact is empty", retryable = false,
                taskPackage = task.taskPackage, checkpointId = null))
            emit("[V1] worker verify failed: artifact empty")
            return
        }
        emit("[V1] worker verify passed: ${task.requiredToolNames.size} tool(s), ${resolved.content.lines().size} lines")
    }

    private fun AgentTask.toExecutionEvent(): AgentLifecycleEvent = when (this) {
        is AgentTask.PreviewDraft -> AgentLifecycleEvent.Executing(
            taskPackage = taskPackage, currentCheckpointId = checkpoint.id, stepLabel = describeTask(this))
        is AgentTask.PublishDraft -> AgentLifecycleEvent.Publishing(
            taskPackage = taskPackage, currentCheckpointId = checkpoint.id)
        is AgentTask.ToolCall -> AgentLifecycleEvent.Executing(
            taskPackage = taskPackage, currentCheckpointId = checkpoint.id, stepLabel = describeTask(this))
        is AgentTask.Summarize -> AgentLifecycleEvent.Executing(
            taskPackage = taskPackage, currentCheckpointId = null, stepLabel = describeTask(this))
        is AgentTask.WorkerVerify -> AgentLifecycleEvent.Executing(
            taskPackage = taskPackage, currentCheckpointId = null, stepLabel = describeTask(this))
    }

    private suspend fun runEditGatePreview(taskPackage: TaskPackage, checkpoint: Checkpoint) {
        val artifact = resolveArtifact(taskPackage)
        val original = when (taskPackage.artifactKind) {
            ArtifactKind.MarkdownDraft -> "# Agent Draft\n"
            ArtifactKind.JsonConfig -> "{}\n"
            ArtifactKind.KotlinCode -> "package ai.openchat.mobile.agent.generated\n\n"
        }
        val snapshot = editGate.snapshot(path = artifact.path, content = original)
        val diff = editGate.diff(snapshot, artifact.content)
        emit("[C5.1] diff preview\n$diff")
        editGate.apply(snapshot, artifact.content).getOrElse { error ->
            shouldStop = true
            onLifecycleEvent(AgentLifecycleEvent.Failed(goal = taskPackage.goal, stage = "preview",
                message = error.message ?: "edit gate rejected", retryable = true,
                taskPackage = taskPackage, checkpointId = checkpoint.id))
            emit("[E2] edit gate rejected: ${error.message}")
        }
        emit("[C5.2] edit gate accepted ${artifact.content.lines().size} lines")
    }

    private fun resolveArtifact(taskPackage: TaskPackage): Artifact {
        val hashEditOutput = toolOutputs["hash_edit"]
        if (hashEditOutput != null) {
            val parts = hashEditOutput.split("|").associate { kv ->
                val eq = kv.indexOf('=')
                if (eq > 0) kv.substring(0, eq) to kv.substring(eq + 1) else "" to kv
            }
            return Artifact(path = parts["path"] ?: taskPackage.artifacts.first().path,
                mime = parts["mime"] ?: taskPackage.artifacts.first().mime,
                content = parts["content"] ?: taskPackage.artifacts.first().content,
                summary = parts["summary"] ?: taskPackage.artifacts.first().summary)
        }
        return taskPackage.artifacts.first()
    }

    private suspend fun runPublishDraft(taskPackage: TaskPackage, checkpoint: Checkpoint, attempts: Int) {
        val resolvedArtifact = resolveArtifact(taskPackage)
        val updatedPackage = taskPackage.copy(artifacts = listOf(resolvedArtifact),
            planSummary = if (toolOutputs.isNotEmpty()) "Tool pipeline: ${toolOutputs.keys.joinToString(" -> ")}" else taskPackage.planSummary)
        val result = runCatching { publishDraft(updatedPackage) }.getOrElse { error ->
            shouldStop = true
            if (attempts <= maxTaskRetries) {
                onLifecycleEvent(AgentLifecycleEvent.Failed(goal = taskPackage.goal, stage = "publish",
                    message = error.message ?: "publish failed", retryable = true,
                    taskPackage = updatedPackage, checkpointId = checkpoint.id))
            }
            emit("[E3] publish failed: ${error.message}")
            return
        }
        emit("[C5.3] $result")
    }

    private fun describeTask(task: AgentTask): String = when (task) {
        is AgentTask.PreviewDraft -> "preview ${task.taskPackage.artifacts.firstOrNull()?.path ?: "?"} for ${task.taskPackage.goal}"
        is AgentTask.PublishDraft -> "publish ${task.taskPackage.publishIntent.branchName} PR"
        is AgentTask.ToolCall -> "tool ${task.toolName} for ${task.taskPackage.goal}"
        is AgentTask.Summarize -> task.text
        is AgentTask.WorkerVerify -> "verify ${task.requiredToolNames.size} tool output(s) for ${task.taskPackage.goal}"
    }

    private fun buildFinalSummary(goal: String): String = buildString {
        appendLine("Multi-role agent complete for: $goal")
        appendLine(orchestrator.milestoneProgress(roleContext))
    }

    private fun buildTaskPackage(goal: String, artifact: DraftArtifact): TaskPackage {
        val createdAtMs = System.currentTimeMillis()
        val branchName = artifactBranchName(artifact.path)
        return TaskPackage(
            id = "task-${createdAtMs.toString().takeLast(8)}", goal = goal, createdAtMs = createdAtMs,
            artifactKind = artifactKind(artifact.format),
            planSummary = "Multi-role pipeline for: $goal",
            artifacts = listOf(Artifact(path = artifact.path, mime = artifactMime(artifact.format),
                content = artifact.content, summary = artifactSummary(goal, artifact.format))),
            checkpoints = listOf(
                Checkpoint(id = CHECKPOINT_PREVIEW, label = "Review artifact", reason = "Inspect before publish", artifactPaths = listOf(artifact.path)),
                Checkpoint(id = CHECKPOINT_PUBLISH, label = "Approve GitHub publish", reason = "Confirm before writing to GitHub", artifactPaths = listOf(artifact.path)),
            ),
            publishIntent = PublishIntent(baseBranch = baseBranchProvider(), branchName = branchName,
                commitMessage = "docs(agent): add ${artifact.path.substringAfterLast('/').substringBeforeLast('.')} draft",
                prTitle = "agent: $goal", prBody = "Multi-role agent draft for:\n\n$goal"),
            rollbackHints = listOf("Close the PR if the draft should not ship.", "Delete branch $branchName if publish was accidental."),
        )
    }

    private fun buildFallbackTaskPackage(goal: String): TaskPackage = TaskPackage(
        id = "task-fallback", goal = goal, createdAtMs = System.currentTimeMillis(),
        artifactKind = ArtifactKind.MarkdownDraft, planSummary = "Fallback task package",
        artifacts = emptyList(), checkpoints = emptyList(),
        publishIntent = PublishIntent(baseBranch = baseBranchProvider(), branchName = "mobile-agent/fallback",
            commitMessage = "docs(agent): fallback draft", prTitle = "agent: $goal", prBody = goal),
        rollbackHints = emptyList(),
    )

    private fun artifactKind(format: ArtifactFormat): ArtifactKind = when (format) {
        ArtifactFormat.MARKDOWN -> ArtifactKind.MarkdownDraft
        ArtifactFormat.JSON -> ArtifactKind.JsonConfig
        ArtifactFormat.KOTLIN -> ArtifactKind.KotlinCode
    }

    private fun artifactMime(format: ArtifactFormat): String = when (format) {
        ArtifactFormat.MARKDOWN -> "text/markdown"
        ArtifactFormat.JSON -> "application/json"
        ArtifactFormat.KOTLIN -> "text/x-kotlin"
    }

    private fun artifactSummary(goal: String, format: ArtifactFormat): String = when (format) {
        ArtifactFormat.MARKDOWN -> "Markdown draft for $goal"
        ArtifactFormat.JSON -> "JSON config draft for $goal"
        ArtifactFormat.KOTLIN -> "Kotlin draft for $goal"
    }

    private fun artifactBranchName(path: String): String =
        "mobile-agent/${path.substringAfterLast('/').substringBeforeLast('.').take(32)}-${System.currentTimeMillis().toString().takeLast(6)}"

    private fun slugify(value: String): String =
        value.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-').ifBlank { "agent-task" }

    private fun inferArtifactFormat(goal: String): ArtifactFormat {
        val normalized = goal.lowercase()
        return if (normalized.contains("json") || normalized.contains("config") || normalized.contains("sdui")) {
            ArtifactFormat.JSON
        } else if (normalized.contains("kotlin") || normalized.contains("kt") || normalized.contains("android class") || normalized.contains("code")) {
            ArtifactFormat.KOTLIN
        } else {
            ArtifactFormat.MARKDOWN
        }
    }

    private fun buildArtifact(goal: String, format: ArtifactFormat, rawContent: String): DraftArtifact {
        val slug = slugify(goal)
        return when (format) {
            ArtifactFormat.MARKDOWN -> DraftArtifact(path = "mobile-agent-output/$slug.md", content = rawContent.ensureHeading(goal), format = format)
            ArtifactFormat.JSON -> DraftArtifact(path = "mobile-agent-output/$slug.json", content = rawContent.ensureJsonDraft(goal), format = format)
            ArtifactFormat.KOTLIN -> DraftArtifact(path = "mobile-agent-output/$slug.kt", content = rawContent.ensureKotlinDraft(goal), format = format)
        }
    }

    private fun String.ensureHeading(goal: String): String =
        if (startsWith("#")) this else "# $goal\n\n$this"

    private fun String.ensureJsonDraft(goal: String): String {
        val trimmed = trim()
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed
        return "{\n\"goal\": \"${goal.replace("\"", "'")}\",\n\"draft\": \"${trimmed.replace("\"", "'")}\"\n}"
    }

    private fun String.ensureKotlinDraft(goal: String): String {
        val trimmed = trim().removePrefix("```kotlin").removePrefix("```").removeSuffix("```").trim()
        if (trimmed.startsWith("package ")) return trimmed
        val className = slugify(goal).split('-').joinToString(separator = "") { part -> part.replaceFirstChar { it.uppercase() } }.ifBlank { "AgentDraft" }
        return "package ai.openchat.mobile.agent.generated\n\nclass $className {\nval draft: String = \"${trimmed.replace("\"", "'")}\"\n}\n"
    }

    private fun parseToolCalls(planText: String): List<Pair<String, Map<String, String>>> {
        val toolCalls = mutableListOf<Pair<String, Map<String, String>>>()
        val lines = planText.lines()
        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            if (line.startsWith("TOOL:")) {
                val rest = line.removePrefix("TOOL:").trim()
                val spaceIndex = rest.indexOf(' ')
                val toolName = if (spaceIndex > 0) rest.substring(0, spaceIndex) else rest
                val argsStr = if (spaceIndex > 0) rest.substring(spaceIndex + 1).trim() else ""
                val args = mutableMapOf<String, String>()
                if (argsStr.isNotBlank()) {
                    argsStr.split("\\s+".toRegex()).forEach { pair ->
                        val eqIndex = pair.indexOf('=')
                        if (eqIndex > 0) {
                            args[pair.substring(0, eqIndex).trim()] = pair.substring(eqIndex + 1).trim()
                        }
                    }
                }
                if (toolRegistry.get(toolName) != null) {
                    toolCalls.add(toolName to args)
                }
            }
            i++
        }
        return toolCalls
    }

    private fun buildToolTaskPackage(goal: String, toolCalls: List<Pair<String, Map<String, String>>>): TaskPackage {
        val createdAtMs = System.currentTimeMillis()
        val branchName = "mobile-agent/tool-${createdAtMs.toString().takeLast(6)}"
        val toolSummary = toolCalls.joinToString(" -> ") { it.first }
        return TaskPackage(
            id = "tool-${createdAtMs.toString().takeLast(8)}", goal = goal, createdAtMs = createdAtMs,
            artifactKind = ArtifactKind.MarkdownDraft, planSummary = "Tool pipeline: $toolSummary",
            artifacts = listOf(Artifact(path = "mobile-agent-output/tool-result.md", mime = "text/markdown",
                content = "# Tool Result\n\nGoal: $goal\n\nTool calls: $toolSummary\n", summary = "Tool execution result")),
            checkpoints = listOf(
                Checkpoint(id = CHECKPOINT_PREVIEW, label = "Review final artifact", reason = "Inspect the tool pipeline result", artifactPaths = listOf("mobile-agent-output/tool-result.md")),
                Checkpoint(id = CHECKPOINT_PUBLISH, label = "Approve GitHub publish", reason = "Confirm before publishing", artifactPaths = listOf("mobile-agent-output/tool-result.md")),
            ),
            publishIntent = PublishIntent(baseBranch = baseBranchProvider(), branchName = branchName,
                commitMessage = "docs(agent): tool pipeline result for $goal", prTitle = "agent: $goal",
                prBody = "Tool pipeline result.\n\nTool calls: $toolSummary"),
            rollbackHints = listOf("Close the generated PR if unwanted.", "Delete branch $branchName if publish was accidental."),
        )
    }

    class ScriptedProvider : ModelProvider {
        override val id: String = "scripted-offline"
        override suspend fun ask(request: ModelRequest): ModelResponse {
            val prompt = request.prompt.lowercase()
            val text = when {
                prompt.contains("you are the sentinel") -> "CATEGORY: other\nSUMMARY: Demo sentinel classification\nNEEDS_EXPLORATION: NO"
                prompt.contains("you are the explorer") -> "- Current state: no relevant files found\n- Gap: nothing exists yet\n- Approach: create new draft"
                prompt.contains("you are the orchestrator") -> "MILESTONE 1: Create initial draft\nTOOLS: none\nACCEPTANCE: draft exists\nPLAN_COMPLETE"
                prompt.contains("you are the reviewer") -> "VERDICT: PASS\nREASONS: - Meets milestone requirements"
                prompt.contains("you are the critic") -> "VERDICT: PASS\nGAPS: - No significant gaps found"
                prompt.contains("you are the auditor") -> "VERDICT: APPROVE\nFINAL_ASSESSMENT: Solution satisfies the goal"
                prompt.contains("json configuration draft") || prompt.contains("return json only") -> "{\n\"screen\": \"agent\",\n\"goal\": \"demo\"\n}"
                prompt.contains("kotlin android code draft") || prompt.contains("return kotlin code only") -> "package ai.openchat.mobile.agent.generated\n\nclass DemoAgentDraft {\nval summary: String = \"Generated Kotlin draft\"\n}\n"
                else -> listOf("## Goal", request.prompt, "", "## Proposed Steps",
                    "- inspect the target repository state",
                    "- generate a first-pass implementation draft",
                    "- open a review PR after approval").joinToString(separator = "\n")
            }
            return ModelResponse(text = text)
        }
    }

    private companion object {
        const val CHECKPOINT_PREVIEW = "preview-draft"
        const val CHECKPOINT_PUBLISH = "publish-draft"
    }
}
