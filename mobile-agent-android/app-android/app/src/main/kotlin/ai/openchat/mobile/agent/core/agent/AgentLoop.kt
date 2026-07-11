package ai.openchat.mobile.agent.core.agent

import ai.openchat.mobile.agent.Artifact
import ai.openchat.mobile.agent.ArtifactKind
import ai.openchat.mobile.agent.Checkpoint
import ai.openchat.mobile.agent.PublishIntent
import ai.openchat.mobile.agent.TaskPackage
import ai.openchat.mobile.agent.core.editgate.EditGate
import ai.openchat.mobile.agent.core.modelrouter.ModelProvider
import ai.openchat.mobile.agent.core.modelrouter.ModelRequest
import ai.openchat.mobile.agent.core.modelrouter.ModelResponse
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

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
// - every mutating/publish step must carry an immutable TaskPackage + Checkpoint

class AgentLoop(
    private val goalProvider: () -> String = { "Demo goal" },
    private val baseBranchProvider: () -> String = { "main" },
    private val stopAfterPlanningProvider: () -> Boolean = { false },
    private val planRequest: suspend (ModelRequest) -> ModelResponse = { request ->
        ScriptedProvider().ask(request)
    },
    private val publishDraft: suspend (taskPackage: TaskPackage) -> String = { _ ->
        "publish unavailable"
    },
    private val onLifecycleEvent: suspend (AgentLifecycleEvent) -> Unit = {},
    private val repoContext: suspend () -> String = { "" },
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

        data class Summarize(
            override val taskPackage: TaskPackage,
            val text: String,
        ) : AgentTask {
            override val checkpoint: Checkpoint? = null
        }
    }

    private val _state = MutableStateFlow(AgentState.IDLE)
    val state: StateFlow<AgentState> = _state.asStateFlow()

    private val _log = MutableSharedFlow<String>(
        replay = 64, // Keep history for new collectors
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )
    val log: SharedFlow<String> = _log.asSharedFlow()

    private val approvalChannel = Channel<Boolean>(capacity = 1)
    private val taskQueue = ArrayDeque<AgentTask>()
    private val editGate = EditGate()
    private var shouldStop = false
    private var cancelled = false
    private var latestTaskPackage: TaskPackage? = null

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
        _state.value = AgentState.RUNNING
        onLifecycleEvent(AgentLifecycleEvent.Planning(goal))
        emit("[C1] agent loop started: $goal")
        runMainLoop(goal)
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
        taskQueue.addLast(AgentTask.Summarize(taskPackage, "agent artifact pipeline complete for: $goal"))

        emit("[C1.resume] resumed from ${fromCheckpointId ?: "start"}: ${taskQueue.size} steps for $goal")
        runMainLoop(goal)
    }

    private suspend fun runMainLoop(goal: String) {
        try {
            while (true) {
                val task = nextTask(goal) ?: break
                emit("[C2] task: ${describeTask(task)}")
                _state.value = AgentState.WAITING
                onLifecycleEvent(
                    AgentLifecycleEvent.AwaitingApproval(
                        taskPackage = task.taskPackage,
                        currentCheckpoint = task.checkpoint ?: task.taskPackage.checkpoints.last(),
                    )
                )
                emit("[C3] awaiting human approval")
                
                // P0-5 FIX: Drain the channel before waiting to avoid stale clicks from previous runs
                while (approvalChannel.tryReceive().isSuccess) { /* drain */ }

                val approved = approvalChannel.receive()
                if (!approved) {
                    cancelled = true
                    onLifecycleEvent(
                        AgentLifecycleEvent.Cancelled(
                            goal = goal,
                            taskPackage = task.taskPackage,
                            checkpointId = task.checkpoint?.id,
                        )
                    )
                    emit("[C4] rejected, stopping")
                    break
                }
                _state.value = AgentState.RUNNING
                onLifecycleEvent(task.toExecutionEvent())
                emit("[C5] approved, executing")
                executeTask(task)
                if (shouldStop) {
                    break
                }
            }
            if (!shouldStop && !cancelled) {
                val completedPackage = latestTaskPackage ?: buildFallbackTaskPackage(goal)
                onLifecycleEvent(
                    AgentLifecycleEvent.Completed(
                        taskPackage = completedPackage,
                        summary = "agent artifact pipeline complete for: $goal",
                    )
                )
                emit("[C7] plan complete")
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

    private suspend fun nextTask(goal: String): AgentTask? {
        if (taskQueue.isEmpty()) {
            val artifactFormat = inferArtifactFormat(goal)
            val context = repoContext()
            val response = planRequest(ModelRequest(prompt = buildPlanningPrompt(goal, artifactFormat, context)))
            if (!response.isSuccess) {
                shouldStop = true
                onLifecycleEvent(
                    AgentLifecycleEvent.Failed(
                        goal = goal,
                        stage = "plan",
                        message = response.error ?: "unknown planning error",
                        retryable = true,
                    )
                )
                emit("[E1] unable to create plan: ${response.error}")
                return null
            }

            val artifact = buildArtifact(goal, artifactFormat, response.text?.trim().orEmpty())
            if (artifact.content.isBlank()) {
                shouldStop = true
                onLifecycleEvent(
                    AgentLifecycleEvent.Failed(
                        goal = goal,
                        stage = "plan",
                        message = "generated draft was empty",
                        retryable = true,
                    )
                )
                emit("[E1.1] generated draft was empty")
                return null
            }

            val taskPackage = buildTaskPackage(goal, artifact)
            latestTaskPackage = taskPackage
            val previewCheckpoint = taskPackage.checkpoints.first { it.id == CHECKPOINT_PREVIEW }
            val publishCheckpoint = taskPackage.checkpoints.first { it.id == CHECKPOINT_PUBLISH }

            taskQueue.addLast(AgentTask.PreviewDraft(taskPackage, previewCheckpoint))
            taskQueue.addLast(AgentTask.PublishDraft(taskPackage, publishCheckpoint))
            taskQueue.addLast(AgentTask.Summarize(taskPackage, "agent artifact pipeline complete for: $goal"))
            emit("[C1.1] seeded ${taskQueue.size} execution steps")

            if (stopAfterPlanningProvider()) {
                emit("[C1.2] plan generated, stopping as requested by PLAN mode")
                shouldStop = true
                return null
            }
        }

        return taskQueue.removeFirstOrNull()
    }

    private suspend fun executeTask(task: AgentTask) {
        when (task) {
            is AgentTask.PreviewDraft -> runEditGatePreview(task.taskPackage, task.checkpoint)
            is AgentTask.PublishDraft -> runPublishDraft(task.taskPackage, task.checkpoint)
            is AgentTask.Summarize -> emit(task.text)
        }
    }

    private suspend fun emit(msg: String) {
        _log.emit(msg)
    }

    private fun AgentTask.toExecutionEvent(): AgentLifecycleEvent = when (this) {
        is AgentTask.PreviewDraft -> AgentLifecycleEvent.Executing(
            taskPackage = taskPackage,
            currentCheckpointId = checkpoint.id,
            stepLabel = describeTask(this),
        )
        is AgentTask.PublishDraft -> AgentLifecycleEvent.Publishing(
            taskPackage = taskPackage,
            currentCheckpointId = checkpoint.id,
        )
        is AgentTask.Summarize -> AgentLifecycleEvent.Executing(
            taskPackage = taskPackage,
            currentCheckpointId = null,
            stepLabel = describeTask(this),
        )
    }

    private suspend fun runEditGatePreview(taskPackage: TaskPackage, checkpoint: Checkpoint) {
        val artifact = taskPackage.artifacts.first()
        val original = when (taskPackage.artifactKind) {
            ArtifactKind.MarkdownDraft -> "# Agent Draft\n"
            ArtifactKind.JsonConfig -> "{}\n"
            ArtifactKind.KotlinCode -> "package ai.openchat.mobile.agent.generated\n\n"
        }
        val snapshot = editGate.snapshot(path = artifact.path, content = original)
        val diff = editGate.diff(snapshot, artifact.content)
        emit("[C5.1] diff preview\n$diff")
        val applied = editGate.apply(snapshot, artifact.content).getOrElse { error ->
            shouldStop = true
            onLifecycleEvent(
                AgentLifecycleEvent.Failed(
                    goal = taskPackage.goal,
                    stage = "preview",
                    message = error.message ?: "edit gate rejected",
                    retryable = true,
                    taskPackage = taskPackage,
                    checkpointId = checkpoint.id,
                )
            )
            emit("[E2] edit gate rejected: ${error.message}")
            return
        }
        emit("[C5.2] edit gate accepted ${applied.lines().size} lines")
    }

    private suspend fun runPublishDraft(taskPackage: TaskPackage, checkpoint: Checkpoint) {
        val result = runCatching {
            publishDraft(taskPackage)
        }.getOrElse { error ->
            shouldStop = true
            onLifecycleEvent(
                AgentLifecycleEvent.Failed(
                    goal = taskPackage.goal,
                    stage = "publish",
                    message = error.message ?: "publish failed",
                    retryable = true,
                    taskPackage = taskPackage,
                    checkpointId = checkpoint.id,
                )
            )
            emit("[E3] publish failed: ${error.message}")
            return
        }
        emit("[C5.3] $result")
    }

    private fun describeTask(task: AgentTask): String = when (task) {
        is AgentTask.PreviewDraft -> "preview ${task.taskPackage.artifacts.first().path} for ${task.taskPackage.goal}"
        is AgentTask.PublishDraft -> "publish ${task.taskPackage.publishIntent.branchName} PR for ${task.taskPackage.goal}"
        is AgentTask.Summarize -> task.text
    }

    private fun buildTaskPackage(goal: String, artifact: DraftArtifact): TaskPackage {
        val createdAtMs = System.currentTimeMillis()
        val branchName = artifactBranchName(artifact.path)
        return TaskPackage(
            id = "task-${createdAtMs.toString().takeLast(8)}",
            goal = goal,
            createdAtMs = createdAtMs,
            artifactKind = artifactKind(artifact.format),
            planSummary = "Generate, review, and publish a draft artifact for: $goal",
            artifacts = listOf(
                Artifact(
                    path = artifact.path,
                    mime = artifactMime(artifact.format),
                    content = artifact.content,
                    summary = artifactSummary(goal, artifact.format),
                )
            ),
            checkpoints = listOf(
                Checkpoint(
                    id = CHECKPOINT_PREVIEW,
                    label = "Review generated artifact",
                    reason = "Inspect the draft before any publish action runs",
                    artifactPaths = listOf(artifact.path),
                ),
                Checkpoint(
                    id = CHECKPOINT_PUBLISH,
                    label = "Approve GitHub publish",
                    reason = "Confirm the artifact and publish intent before writing to GitHub",
                    artifactPaths = listOf(artifact.path),
                ),
            ),
            publishIntent = PublishIntent(
                baseBranch = baseBranchProvider(),
                branchName = branchName,
                commitMessage = "docs(agent): add ${artifact.path.substringAfterLast('/').substringBeforeLast('.')} draft",
                prTitle = "agent: $goal",
                prBody = "Automated draft generated by OpenChat Android agent for goal:\n\n$goal",
            ),
            rollbackHints = listOf(
                "Close the generated PR if the draft should not ship.",
                "Delete branch $branchName if the publish attempt was accidental.",
            ),
        )
    }

    private fun buildFallbackTaskPackage(goal: String): TaskPackage = TaskPackage(
        id = "task-fallback",
        goal = goal,
        createdAtMs = System.currentTimeMillis(),
        artifactKind = ArtifactKind.MarkdownDraft,
        planSummary = "Fallback task package",
        artifacts = emptyList(),
        checkpoints = emptyList(),
        publishIntent = PublishIntent(
            baseBranch = baseBranchProvider(),
            branchName = "mobile-agent/fallback",
            commitMessage = "docs(agent): fallback draft",
            prTitle = "agent: $goal",
            prBody = goal,
        ),
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
        return if (
            normalized.contains("json") ||
            normalized.contains("config") ||
            normalized.contains("sdui")
        ) {
            ArtifactFormat.JSON
        } else if (
            normalized.contains("kotlin") ||
            normalized.contains("kt") ||
            normalized.contains("android class") ||
            normalized.contains("code")
        ) {
            ArtifactFormat.KOTLIN
        } else {
            ArtifactFormat.MARKDOWN
        }
    }

    private fun buildPlanningPrompt(goal: String, format: ArtifactFormat, context: String): String {
        val contextSnippet = if (context.isNotBlank()) "\n\nRepository Context:\n$context" else ""
        return when (format) {
            ArtifactFormat.MARKDOWN ->
                "Create a concise markdown implementation draft for this mobile coding goal: $goal$contextSnippet"
            ArtifactFormat.JSON ->
                "Create a concise JSON configuration draft for this mobile coding goal: $goal. Return JSON only.$contextSnippet"
            ArtifactFormat.KOTLIN ->
                "Create a concise Kotlin Android code draft for this mobile coding goal: $goal. Return Kotlin code only without markdown fences.$contextSnippet"
        }
    }

    private fun buildArtifact(goal: String, format: ArtifactFormat, rawContent: String): DraftArtifact {
        val slug = slugify(goal)
        return when (format) {
            ArtifactFormat.MARKDOWN -> DraftArtifact(
                path = "mobile-agent-output/$slug.md",
                content = rawContent.ensureHeading(goal),
                format = format,
            )
            ArtifactFormat.JSON -> DraftArtifact(
                path = "mobile-agent-output/$slug.json",
                content = rawContent.ensureJsonDraft(goal),
                format = format,
            )
            ArtifactFormat.KOTLIN -> DraftArtifact(
                path = "mobile-agent-output/$slug.kt",
                content = rawContent.ensureKotlinDraft(goal),
                format = format,
            )
        }
    }

    private fun String.ensureHeading(goal: String): String =
        if (startsWith("#")) this else "# $goal\n\n$this"

    private fun String.ensureJsonDraft(goal: String): String {
        val trimmed = trim()
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed
        return "{\n  \"goal\": \"${goal.replace("\"", "'")}\",\n  \"draft\": \"${trimmed.replace("\"", "'")}\"\n}"
    }

    private fun String.ensureKotlinDraft(goal: String): String {
        val trimmed = trim()
            .removePrefix("```kotlin")
            .removePrefix("```")
            .removeSuffix("```")
            .trim()
        if (trimmed.startsWith("package ")) return trimmed
        val className = slugify(goal)
            .split('-')
            .joinToString(separator = "") { part -> part.replaceFirstChar { it.uppercase() } }
            .ifBlank { "AgentDraft" }
        return "package ai.openchat.mobile.agent.generated\n\nclass $className {\n  val draft: String = \"${trimmed.replace("\"", "'")}\"\n}\n"
    }

    class ScriptedProvider : ModelProvider {
        override val id: String = "scripted-offline"

        override suspend fun ask(request: ModelRequest): ModelResponse {
            val prompt = request.prompt.lowercase()
            val text = if (prompt.contains("json configuration draft") || prompt.contains("return json only")) {
                "{\n  \"screen\": \"agent\",\n  \"goal\": \"demo\",\n  \"steps\": [\"inspect\", \"draft\", \"publish\"]\n}"
            } else if (prompt.contains("kotlin android code draft") || prompt.contains("return kotlin code only")) {
                "package ai.openchat.mobile.agent.generated\n\nclass DemoAgentDraft {\n  val summary: String = \"Generated Kotlin draft\"\n}\n"
            } else {
                listOf(
                    "## Goal",
                    request.prompt,
                    "",
                    "## Proposed Steps",
                    "- inspect the target repository state",
                    "- generate a first-pass implementation draft",
                    "- open a review PR after approval",
                ).joinToString(separator = "\n")
            }
            return ModelResponse(text = text)
        }
    }

    private companion object {
        const val CHECKPOINT_PREVIEW = "preview-draft"
        const val CHECKPOINT_PUBLISH = "publish-draft"
    }
}
