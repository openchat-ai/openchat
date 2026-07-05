package ai.openchat.mobile.agent

import android.text.InputType
import android.os.Bundle
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import ai.openchat.mobile.agent.core.agent.AgentLifecycleEvent
import ai.openchat.mobile.agent.core.agent.AgentLoop
import ai.openchat.mobile.agent.core.github.CommitFile
import ai.openchat.mobile.agent.core.github.GitHubClient
import ai.openchat.mobile.agent.core.modelrouter.ModelMessage
import ai.openchat.mobile.agent.core.modelrouter.ModelRequest
import ai.openchat.mobile.agent.core.modelrouter.ModelRouter
import ai.openchat.mobile.agent.core.modelrouter.OpenAiCompatibleConfig
import ai.openchat.mobile.agent.core.modelrouter.OpenAiCompatibleProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var tvStatus: TextView
    private lateinit var tvConfigSummary: TextView
    private lateinit var etAskPrompt: EditText
    private lateinit var etAgentGoal: EditText
    private lateinit var tvAskResponse: TextView
    private lateinit var tvAgentRecoverySummary: TextView
    private lateinit var tvLog: TextView
    private lateinit var btnModeAsk: Button
    private lateinit var btnModeAgent: Button
    private lateinit var btnAskClear: Button
    private lateinit var btnAsk: Button
    private lateinit var btnStart: Button
    private lateinit var btnApprove: Button
    private lateinit var btnReject: Button
    private lateinit var btnSettings: Button
    private lateinit var panelAsk: View
    private lateinit var panelAgent: View

    private lateinit var settingsStore: AppSettingsStore
    private lateinit var agentLoop: AgentLoop
    private var loopJob: Job? = null
    private var askJob: Job? = null
    private var runtimeState = AppRuntimeState()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        settingsStore = AppSettingsStore(this)
        agentLoop = buildAgentLoop()

        tvStatus = findViewById(R.id.tvStatus)
        tvConfigSummary = findViewById(R.id.tvConfigSummary)
        etAskPrompt = findViewById(R.id.etAskPrompt)
        etAgentGoal = findViewById(R.id.etAgentGoal)
        tvAskResponse = findViewById(R.id.tvAskResponse)
        tvAgentRecoverySummary = findViewById(R.id.tvAgentRecoverySummary)
        tvLog = findViewById(R.id.tvLog)
        btnModeAsk = findViewById(R.id.btnModeAsk)
        btnModeAgent = findViewById(R.id.btnModeAgent)
        btnAskClear = findViewById(R.id.btnAskClear)
        btnAsk = findViewById(R.id.btnAsk)
        btnStart = findViewById(R.id.btnStart)
        btnApprove = findViewById(R.id.btnApprove)
        btnReject = findViewById(R.id.btnReject)
        btnSettings = findViewById(R.id.btnSettings)
        panelAsk = findViewById(R.id.panelAsk)
        panelAgent = findViewById(R.id.panelAgent)

        btnModeAsk.setOnClickListener { switchMode(RuntimeMode.ASK) }
        btnModeAgent.setOnClickListener { switchMode(RuntimeMode.AGENT) }
        btnAskClear.setOnClickListener { clearAskHistory() }
        btnAsk.setOnClickListener { submitAsk() }
        btnStart.setOnClickListener { toggleAgent() }
        btnApprove.setOnClickListener { agentLoop.approve() }
        btnReject.setOnClickListener { agentLoop.reject() }
        btnSettings.setOnClickListener { showSettingsDialog() }

        dispatch(RuntimeAction.HydrateAskHistory(settingsStore.loadAskHistory()))
        settingsStore.loadRuntimeSnapshot()?.let { snapshot ->
            dispatch(RuntimeAction.HydratePersistence(snapshot))
        }
        renderSettingsSummary()
        observeState()
        renderRuntimeState()
    }

    private fun toggleAgent() {
        if (loopJob?.isActive != true) {
            agentLoop = buildAgentLoop()
        }
        if (loopJob?.isActive == true) {
            loopJob?.cancel()
            dispatch(
                RuntimeAction.AgentFailed(
                    error = buildAppError(
                        kind = ErrorKind.Cancellation,
                        code = "AGENT_CANCELLED",
                        message = "Agent execution interrupted",
                        retryable = true,
                    ),
                    goal = etAgentGoal.text.toString(),
                )
            )
        } else {
            dispatch(
                RuntimeAction.ObserveAgent(
                    AgentSessionState.Planning(
                        goal = etAgentGoal.text.toString(),
                        startedAtMs = System.currentTimeMillis(),
                    )
                )
            )
            loopJob = lifecycleScope.launch { agentLoop.run() }
        }
    }

    private fun observeState() {
        lifecycleScope.launch {
            agentLoop.log.collect { entry ->
                tvLog.append("$entry\n")
            }
        }
    }

    private fun buildAgentLoop(): AgentLoop {
        return AgentLoop(
            goalProvider = { etAgentGoal.text.toString() },
            baseBranchProvider = { settingsStore.load().github.baseBranch.ifBlank { "main" } },
            planRequest = { request ->
                val settings = settingsStore.load()
                if (!settings.provider.isComplete) {
                    return@AgentLoop AgentLoop.ScriptedProvider().ask(request)
                }

                val router = ModelRouter(
                    listOf(
                        OpenAiCompatibleProvider(
                            id = "primary",
                            config = OpenAiCompatibleConfig(
                                baseUrl = settings.provider.baseUrl,
                                apiKey = settings.provider.apiKey,
                                model = settings.provider.model,
                            )
                        ),
                        AgentLoop.ScriptedProvider(),
                    )
                )
                withContext(Dispatchers.IO) {
                    router.ask(request)
                }
            },
            publishDraft = { taskPackage ->
                val settings = settingsStore.load()
                require(settings.github.isComplete) { getString(R.string.log_agent_missing_config) }

                val github = GitHubClient(
                    owner = settings.github.owner,
                    repo = settings.github.repo,
                    token = settings.github.token,
                )
                val publishIntent = taskPackage.publishIntent
                withContext(Dispatchers.Main) {
                    dispatch(
                        RuntimeAction.ObserveAgent(
                            AgentSessionState.Publishing(
                                taskPackage = taskPackage,
                                currentCheckpointId = runtimeState.recovery.lastCheckpointId,
                            )
                        )
                    )
                }
                val artifact = taskPackage.artifacts.first()
                val baseSha = github.getBranchHeadSha(publishIntent.baseBranch).getOrThrow()
                github.createBranch(publishIntent.branchName, baseSha).getOrThrow()
                github.commitFiles(
                    branch = publishIntent.branchName,
                    files = listOf(
                        CommitFile(
                            path = artifact.path,
                            content = artifact.content,
                        )
                    ),
                    message = publishIntent.commitMessage
                ).getOrThrow()
                val prNumber = github.createPullRequest(
                    branch = publishIntent.branchName,
                    base = publishIntent.baseBranch,
                    title = publishIntent.prTitle,
                    body = publishIntent.prBody,
                ).getOrThrow()
                "created PR #$prNumber on ${settings.github.owner}/${settings.github.repo}"
            },
            onLifecycleEvent = { event ->
                withContext(Dispatchers.Main) {
                    when (event) {
                        is AgentLifecycleEvent.Planning -> dispatch(
                            RuntimeAction.ObserveAgent(
                                AgentSessionState.Planning(
                                    goal = event.goal,
                                    startedAtMs = System.currentTimeMillis(),
                                )
                            )
                        )
                        is AgentLifecycleEvent.AwaitingApproval -> dispatch(
                            RuntimeAction.ObserveAgent(
                                AgentSessionState.AwaitingApproval(
                                    taskPackage = event.taskPackage,
                                    currentCheckpoint = event.currentCheckpoint,
                                )
                            )
                        )
                        is AgentLifecycleEvent.Executing -> dispatch(
                            RuntimeAction.ObserveAgent(
                                AgentSessionState.Executing(
                                    taskPackage = event.taskPackage,
                                    currentCheckpointId = event.currentCheckpointId,
                                    currentStepLabel = event.stepLabel,
                                )
                            )
                        )
                        is AgentLifecycleEvent.Publishing -> dispatch(
                            RuntimeAction.ObserveAgent(
                                AgentSessionState.Publishing(
                                    taskPackage = event.taskPackage,
                                    currentCheckpointId = event.currentCheckpointId,
                                )
                            )
                        )
                        is AgentLifecycleEvent.Completed -> dispatch(
                            RuntimeAction.ObserveAgent(
                                AgentSessionState.Completed(
                                    taskPackage = event.taskPackage,
                                    summary = event.summary,
                                )
                            )
                        )
                        is AgentLifecycleEvent.Cancelled -> dispatch(
                            RuntimeAction.AgentFailed(
                                error = buildAppError(
                                    kind = ErrorKind.Cancellation,
                                    code = "AGENT_CANCELLED",
                                    message = "Agent execution interrupted",
                                    retryable = true,
                                ),
                                goal = event.goal,
                                taskPackage = event.taskPackage,
                                checkpointId = event.checkpointId,
                            )
                        )
                        is AgentLifecycleEvent.Failed -> dispatch(
                            RuntimeAction.AgentFailed(
                                error = buildAppError(
                                    kind = mapAgentErrorKind(event.stage, event.message),
                                    code = "AGENT_${event.stage.uppercase()}",
                                    message = event.message,
                                    retryable = event.retryable,
                                ),
                                goal = event.goal,
                                taskPackage = event.taskPackage,
                                checkpointId = event.checkpointId,
                            )
                        )
                    }
                }
            }
        )
    }

    private fun submitAsk() {
        val prompt = etAskPrompt.text.toString().trim()
        if (prompt.isBlank()) {
            tvAskResponse.text = getString(R.string.hint_ask_prompt)
            return
        }
        if (askJob?.isActive == true) {
            return
        }

        askJob = lifecycleScope.launch {
            dispatch(
                RuntimeAction.AskStarted(
                    prompt = prompt,
                    startedAtMs = System.currentTimeMillis(),
                )
            )
            etAskPrompt.setText("")
            tvLog.append(getString(R.string.log_ask_sent) + "\n")
            try {
                val result = askModel(prompt)
                dispatch(
                    RuntimeAction.AskCompleted(
                        completedAtMs = System.currentTimeMillis(),
                        response = result,
                    )
                )
                tvLog.append(getString(R.string.log_ask_done) + "\n")
            } catch (error: TimeoutCancellationException) {
                dispatch(
                    RuntimeAction.AskFailed(
                        error = buildAppError(
                            kind = ErrorKind.ProviderTimeout,
                            code = "ASK_TIMEOUT",
                            message = "Ask request timed out after 30s",
                            retryable = true,
                        ),
                        preservePrompt = prompt,
                    )
                )
                tvLog.append(getString(R.string.log_ask_failed) + ": timeout\n")
            } catch (error: CancellationException) {
                dispatch(RuntimeAction.AskCancelled(prompt))
                tvLog.append("[ASK] cancelled\n")
            } catch (error: IllegalStateException) {
                val errorMessage = error.message ?: getString(R.string.log_ask_failed)
                dispatch(
                    RuntimeAction.AskFailed(
                        error = buildAppError(
                            kind = mapAskErrorKind(errorMessage),
                            code = "ASK_FAILED",
                            message = errorMessage,
                            retryable = true,
                        ),
                        preservePrompt = prompt,
                    )
                )
                tvLog.append(getString(R.string.log_ask_failed) + ": ${error.message}\n")
            }
        }
    }

    private suspend fun askModel(prompt: String): String {
        val settings = settingsStore.load()
        if (!settings.provider.isComplete) {
            throw IllegalStateException(getString(R.string.status_ask_config_needed))
        }

        val provider = OpenAiCompatibleProvider(
            id = "ask-primary",
            config = OpenAiCompatibleConfig(
                baseUrl = settings.provider.baseUrl,
                apiKey = settings.provider.apiKey,
                model = settings.provider.model,
            )
        )

        val response = withTimeout(30_000) {
            withContext(Dispatchers.IO) {
                provider.streamAsk(
                    ModelRequest(
                        prompt = prompt,
                        messages = runtimeState.askHistory
                            .dropLast(1)
                            .filter { it.role != "System" }
                            .map { turn ->
                                ModelMessage(
                                    role = if (turn.role == "You") "user" else "assistant",
                                    content = turn.content,
                                )
                            } + ModelMessage(role = "user", content = prompt)
                    ),
                    onDelta = { delta ->
                        withContext(Dispatchers.Main) {
                            dispatch(RuntimeAction.AskDelta(delta))
                        }
                    }
                )
            }
        }

        if (!response.isSuccess) {
            throw IllegalStateException(response.error ?: getString(R.string.log_ask_failed))
        }
        return response.text.orEmpty()
    }

    private fun renderAskHistory() {
        tvAskResponse.text = if (runtimeState.askHistory.isEmpty()) {
            getString(R.string.ask_placeholder)
        } else {
            runtimeState.askHistory.joinToString(separator = "\n\n") { turn ->
                "${turn.role}:\n${turn.content}"
            }
        }
    }

    private fun clearAskHistory() {
        if (askJob?.isActive == true) {
            return
        }
        dispatch(RuntimeAction.ClearAskHistory)
        tvLog.append(getString(R.string.log_ask_cleared) + "\n")
    }

    private fun switchMode(mode: RuntimeMode) {
        dispatch(RuntimeAction.SwitchMode(mode))
    }

    private fun renderSettingsSummary() {
        val settings = settingsStore.load()
        dispatch(
            RuntimeAction.UpdateSettings(
                providerReady = settings.provider.isComplete,
                githubReady = settings.github.isComplete,
            )
        )
        val providerStatus = if (settings.provider.isComplete) {
            getString(R.string.summary_provider_ready, settings.provider.model)
        } else {
            getString(R.string.summary_provider_offline)
        }
        val githubStatus = if (settings.github.isComplete) {
            getString(R.string.summary_github_ready, settings.github.owner, settings.github.repo, settings.github.baseBranch)
        } else {
            getString(R.string.summary_github_missing)
        }
        tvConfigSummary.text = listOf(providerStatus, githubStatus).joinToString(separator = "\n")
    }

    private fun showSettingsDialog() {
        val settings = settingsStore.load()
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 24, 40, 24)
        }

        val providerBaseUrl = textField(getString(R.string.hint_provider_base_url), settings.provider.baseUrl)
        val providerApiKey = textField(getString(R.string.hint_provider_api_key), settings.provider.apiKey, true)
        val providerModel = textField(getString(R.string.hint_provider_model), settings.provider.model)
        val githubOwner = textField(getString(R.string.hint_github_owner), settings.github.owner)
        val githubRepo = textField(getString(R.string.hint_github_repo), settings.github.repo)
        val githubToken = textField(getString(R.string.hint_github_token), settings.github.token, true)
        val githubBaseBranch = textField(getString(R.string.hint_github_base_branch), settings.github.baseBranch)

        listOf(
            providerBaseUrl,
            providerApiKey,
            providerModel,
            githubOwner,
            githubRepo,
            githubToken,
            githubBaseBranch,
        ).forEach(container::addView)

        val scrollView = ScrollView(this).apply {
            addView(container)
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.title_settings)
            .setView(scrollView)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.action_save) { _, _ ->
                settingsStore.save(
                    AppSettings(
                        provider = ProviderSettings(
                            baseUrl = providerBaseUrl.text.toString(),
                            apiKey = providerApiKey.text.toString(),
                            model = providerModel.text.toString(),
                        ),
                        github = GitHubSettings(
                            owner = githubOwner.text.toString(),
                            repo = githubRepo.text.toString(),
                            token = githubToken.text.toString(),
                            baseBranch = githubBaseBranch.text.toString(),
                        )
                    )
                )
                agentLoop = buildAgentLoop()
                renderSettingsSummary()
                tvLog.append(getString(R.string.log_settings_saved) + "\n")
            }
            .show()
    }

    private fun textField(hint: String, value: String, secret: Boolean = false): EditText {
        return EditText(this).apply {
            this.hint = hint
            setText(value)
            inputType = if (secret) {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            } else {
                InputType.TYPE_CLASS_TEXT
            }
        }
    }

    private fun dispatch(action: RuntimeAction) {
        val previousHistory = runtimeState.askHistory
        runtimeState = runtimeState.reduce(action)
        if (runtimeState.askHistory != previousHistory) {
            settingsStore.saveAskHistory(runtimeState.askHistory)
        }
        settingsStore.saveRuntimeSnapshot(runtimeState.toPersistenceSnapshot())
        renderRuntimeState()
    }

    private fun renderRuntimeState() {
        renderAskHistory()
        renderAgentRecoverySummary()
        runtimeState.recovery.pendingAskPrompt?.let { pending ->
            if (pending.isNotBlank() && etAskPrompt.text.isNullOrBlank()) {
                etAskPrompt.setText(pending)
                etAskPrompt.setSelection(pending.length)
            }
        }
        runtimeState.recovery.pendingAgentGoal?.let { pending ->
            if (pending.isNotBlank() && etAgentGoal.text.isNullOrBlank()) {
                etAgentGoal.setText(pending)
                etAgentGoal.setSelection(pending.length)
            }
        }
        panelAsk.visibility = if (runtimeState.mode == RuntimeMode.ASK) View.VISIBLE else View.GONE
        panelAgent.visibility = if (runtimeState.mode == RuntimeMode.AGENT) View.VISIBLE else View.GONE

        val askBusy = runtimeState.ask is AskSessionState.Streaming
        btnModeAsk.isEnabled = runtimeState.mode != RuntimeMode.ASK
        btnModeAgent.isEnabled = runtimeState.mode != RuntimeMode.AGENT && !askBusy
        btnAsk.isEnabled = !askBusy
        btnAskClear.isEnabled = !askBusy
        etAskPrompt.isEnabled = !askBusy

        if (runtimeState.mode == RuntimeMode.ASK) {
            tvStatus.text = when {
                runtimeState.recovery.needsResume && !runtimeState.recovery.lastRecoveryMessage.isNullOrBlank() ->
                    runtimeState.recovery.lastRecoveryMessage
                askBusy -> getString(R.string.status_ask_running)
                !runtimeState.settings.providerReady -> getString(R.string.status_ask_config_needed)
                else -> getString(R.string.status_ask_ready)
            }
            return
        }

        if (runtimeState.recovery.needsResume && !runtimeState.recovery.lastRecoveryMessage.isNullOrBlank()) {
            tvStatus.text = runtimeState.recovery.lastRecoveryMessage
        }
        updateAgentUi(runtimeState.agent)
    }

    private fun renderAgentRecoverySummary() {
        val recoveredTaskPackage = runtimeState.recovery.pendingTaskPackage
        val activeTaskPackage = currentAgentTaskPackage()
        val taskPackage = recoveredTaskPackage ?: activeTaskPackage
        if (taskPackage == null) {
            tvAgentRecoverySummary.visibility = View.GONE
            return
        }

        val checkpoint = when {
            runtimeState.recovery.lastCheckpointId != null -> taskPackage.findCheckpoint(runtimeState.recovery.lastCheckpointId)
            runtimeState.agent is AgentSessionState.AwaitingApproval -> (runtimeState.agent as AgentSessionState.AwaitingApproval).currentCheckpoint
            else -> null
        }
        val title = if (recoveredTaskPackage != null) {
            getString(R.string.agent_recovery_title)
        } else {
            getString(R.string.agent_active_title)
        }
        tvAgentRecoverySummary.text = buildAgentRecoverySummary(title, taskPackage, checkpoint)
        tvAgentRecoverySummary.visibility = View.VISIBLE
    }

    private fun updateAgentUi(state: AgentSessionState) {
        if (!(runtimeState.recovery.needsResume && !runtimeState.recovery.lastRecoveryMessage.isNullOrBlank())) {
            tvStatus.text = when (state) {
                AgentSessionState.Idle,
                is AgentSessionState.Completed -> getString(R.string.label_agent_idle)
                is AgentSessionState.AwaitingApproval -> getString(R.string.label_agent_waiting)
                is AgentSessionState.Planning,
                is AgentSessionState.Executing,
                is AgentSessionState.Publishing -> getString(R.string.label_agent_running)
            }
        }
        val waiting = state is AgentSessionState.AwaitingApproval
        btnApprove.visibility = if (waiting) View.VISIBLE else View.GONE
        btnReject.visibility = if (waiting) View.VISIBLE else View.GONE
        val active = state !is AgentSessionState.Idle && state !is AgentSessionState.Completed
        btnStart.text = if (active)
            getString(R.string.action_stop)
        else
            getString(R.string.action_start)
    }

    private fun currentAgentTaskPackage(): TaskPackage? = when (val state = runtimeState.agent) {
        AgentSessionState.Idle,
        is AgentSessionState.Planning -> null
        is AgentSessionState.AwaitingApproval -> state.taskPackage
        is AgentSessionState.Executing -> state.taskPackage
        is AgentSessionState.Publishing -> state.taskPackage
        is AgentSessionState.Completed -> state.taskPackage
    }

    private fun buildAgentRecoverySummary(
        title: String,
        taskPackage: TaskPackage,
        checkpoint: Checkpoint?,
    ): String = buildString {
        append(title)
        append("\n")
        append("goal: ")
        append(taskPackage.goal)
        append("\n")
        append("kind: ")
        append(taskPackage.artifactKind.name)
        append("\n")
        append("artifact: ")
        append(taskPackage.artifacts.firstOrNull()?.path ?: "none")
        append("\n")
        append("checkpoint: ")
        append(checkpoint?.label ?: "resume review")
        append("\n")
        append("reason: ")
        append(checkpoint?.reason ?: taskPackage.planSummary)
        append("\n")
        append("publish: ")
        append(taskPackage.publishIntent.branchName)
        append(" -> ")
        append(taskPackage.publishIntent.baseBranch)
        append("\n")
        append("commit: ")
        append(taskPackage.publishIntent.commitMessage)
        if (taskPackage.rollbackHints.isNotEmpty()) {
            append("\n")
            append("rollback: ")
            append(taskPackage.rollbackHints.first())
        }
    }

    private fun buildAppError(
        kind: ErrorKind,
        code: String,
        message: String,
        retryable: Boolean,
    ): AppError = AppError(
        kind = kind,
        code = code,
        message = message,
        retryable = retryable,
        occurredAtMs = System.currentTimeMillis(),
        stateSnapshot = buildStateSnapshot(),
    )

    private fun buildStateSnapshot(): String = buildString {
        append("mode=")
        append(runtimeState.mode.name)
        append(";ask=")
        append(runtimeState.ask.javaClass.simpleName)
        append(";agent=")
        append(runtimeState.agent.javaClass.simpleName)
        append(";resume=")
        append(runtimeState.recovery.needsResume)
    }

    private fun mapAskErrorKind(message: String): ErrorKind {
        val normalized = message.lowercase()
        return when {
            normalized.contains("401") || normalized.contains("unauthorized") || normalized.contains("invalid api key") -> ErrorKind.ProviderAuth
            normalized.contains("timeout") -> ErrorKind.ProviderTimeout
            normalized.contains("json") || normalized.contains("protocol") || normalized.contains("malformed") -> ErrorKind.ProviderProtocol
            else -> ErrorKind.Unknown
        }
    }

    private fun mapAgentErrorKind(stage: String, message: String): ErrorKind {
        val normalized = message.lowercase()
        return when {
            normalized.contains("401") || normalized.contains("403") || normalized.contains("bad credentials") -> ErrorKind.GitHubAuth
            normalized.contains("409") || normalized.contains("already exists") || normalized.contains("conflict") -> ErrorKind.GitHubConflict
            normalized.contains("429") || normalized.contains("rate limit") -> ErrorKind.GitHubRateLimit
            stage == "plan" -> ErrorKind.ProviderProtocol
            else -> ErrorKind.Unknown
        }
    }
}
