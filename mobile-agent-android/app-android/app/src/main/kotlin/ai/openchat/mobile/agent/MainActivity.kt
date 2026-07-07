package ai.openchat.mobile.agent

import android.text.InputType
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.TextPaint
import android.text.method.LinkMovementMethod
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.view.View
import android.widget.AdapterView
import android.widget.Button
import android.widget.Spinner
import android.widget.TextView
import android.text.style.BackgroundColorSpan
import android.text.style.ClickableSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.widget.TextView.OnEditorActionListener
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import ai.openchat.mobile.agent.core.agent.AgentLifecycleEvent
import ai.openchat.mobile.agent.core.agent.AgentLoop
import ai.openchat.mobile.agent.core.github.CommitFile
import ai.openchat.mobile.agent.core.github.GitHubClient
import ai.openchat.mobile.agent.core.github.GitHubDiscovery
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

// === invariants ===
// - 4 static modes (ASK, PLAN, AGENT, ADAPTIVE) are bridged to AppRuntimeState
// - agentLoop is recreated for each new goal or resume
// - UI state is updated via collect on runtimeState flow

class MainActivity : AppCompatActivity() {

    private lateinit var tvStatus: TextView
    private lateinit var tvConversation: TextView
    private lateinit var tvAgentRecoverySummary: TextView
    private lateinit var tvModel: TextView
    private lateinit var etInput: EditText
    private lateinit var btnSend: Button
    private lateinit var btnApprove: Button
    private lateinit var btnReject: Button
    private lateinit var btnResume: Button
    private lateinit var btnSettings: Button
    private lateinit var btnStop: Button
    private lateinit var btnModeAsk: Button
    private lateinit var btnModePlan: Button
    private lateinit var btnModeAgent: Button
    private lateinit var btnModeAdaptive: Button
    private lateinit var layoutAgentActions: View

    private lateinit var settingsStore: AppSettingsStore
    private lateinit var agentLoop: AgentLoop
    private var loopJob: Job? = null
    private var askJob: Job? = null
    private var runtimeState = AppRuntimeState()
    private val tabs = mutableListOf<ChatTab>()
    private var activeTabIndex = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        settingsStore = AppSettingsStore(this)
        agentLoop = buildAgentLoop()

        tvStatus = findViewById(R.id.tvStatus)
        tvConversation = findViewById(R.id.tvConversation)
        tvAgentRecoverySummary = findViewById(R.id.tvAgentRecoverySummary)
        tvModel = findViewById(R.id.tvModel)
        etInput = findViewById(R.id.etInput)
        btnSend = findViewById(R.id.btnSend)
        btnApprove = findViewById(R.id.btnApprove)
        btnReject = findViewById(R.id.btnReject)
        btnResume = findViewById(R.id.btnResume)
        btnSettings = findViewById(R.id.btnSettings)
        btnStop = findViewById(R.id.btnStop)

        btnModeAsk = findViewById(R.id.btnModeAsk)
        btnModePlan = findViewById(R.id.btnModePlan)
        btnModeAgent = findViewById(R.id.btnModeAgent)
        btnModeAdaptive = findViewById(R.id.btnModeAdaptive)

        layoutAgentActions = findViewById(R.id.layoutAgentActions)

        btnModeAsk.setOnClickListener { switchMode(RuntimeMode.ASK) }
        btnModePlan.setOnClickListener { switchMode(RuntimeMode.PLAN) }
        btnModeAgent.setOnClickListener { switchMode(RuntimeMode.AGENT) }
        btnModeAdaptive.setOnClickListener { switchMode(RuntimeMode.ADAPTIVE) }

        btnSend.setOnClickListener { sendMessage() }
        etInput.setOnEditorActionListener(OnEditorActionListener { _, actionId, event ->
            if (actionId == EditorInfo.IME_ACTION_SEND ||
                (event?.action == KeyEvent.ACTION_DOWN && event.keyCode == KeyEvent.KEYCODE_ENTER && !event.isShiftPressed)
            ) {
                sendMessage()
                true
            } else false
        })
        etInput.imeOptions = EditorInfo.IME_ACTION_SEND
        etInput.setRawInputType(InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE)
        btnApprove.setOnClickListener { agentLoop.approve() }
        btnReject.setOnClickListener { agentLoop.reject() }
        btnResume.setOnClickListener { resumeAgent() }
        btnSettings.setOnClickListener { showSettingsDialog() }
        btnStop.setOnClickListener { stopRunning() }
        tvModel.setOnClickListener { showSettingsDialog() }

        val savedTabs = settingsStore.loadTabs()
        tabs.addAll(savedTabs.ifEmpty { listOf(ChatTab(name = "Chat 1")) })
        activeTabIndex = 0
        val firstTab = tabs[0]
        runtimeState = runtimeState.copy(mode = firstTab.mode)
        dispatch(RuntimeAction.HydrateAskHistory(firstTab.askHistory))
        settingsStore.loadRuntimeSnapshot()?.let { snapshot ->
            dispatch(RuntimeAction.HydratePersistence(snapshot))
        }
        renderSettingsSummary()
        observeState()
        renderRuntimeState()
    }

    private fun sendMessage() {
        val text = etInput.text.toString().trim()
        if (text.isBlank()) return

        when (runtimeState.mode) {
            RuntimeMode.ASK -> {
                if (askJob?.isActive == true) return
                etInput.setText("")
                submitAsk(text)
            }
            RuntimeMode.PLAN, RuntimeMode.AGENT -> toggleAgent(text)
            RuntimeMode.ADAPTIVE -> {
                // Adaptive placeholder: for now just behave like Ask
                if (askJob?.isActive == true) return
                etInput.setText("")
                submitAsk("[Adaptive] $text")
            }
        }
    }

    private fun stopRunning() {
        if (askJob?.isActive == true) {
            askJob?.cancel()
            askJob = null
        }
        if (loopJob?.isActive == true) {
            loopJob?.cancel()
            val goal = etInput.text.toString()
            dispatch(
                RuntimeAction.AgentFailed(
                    error = buildAppError(
                        kind = ErrorKind.Cancellation,
                        code = "AGENT_CANCELLED",
                        message = "Agent execution interrupted",
                        retryable = true,
                    ),
                    goal = goal,
                )
            )
            loopJob = null
        }
    }

    private fun toggleAgent(goal: String) {
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
                    goal = goal,
                )
            )
        } else {
            agentLoop = buildAgentLoop()
            tvConversation.text = ""
            dispatch(
                RuntimeAction.ObserveAgent(
                    AgentSessionState.Planning(
                        goal = goal,
                        startedAtMs = System.currentTimeMillis(),
                    )
                )
            )
            loopJob = lifecycleScope.launch { agentLoop.run() }
        }
    }

    private fun resumeAgent() {
        val savedPackage = runtimeState.recovery.pendingTaskPackage ?: return
        val checkpointId = runtimeState.recovery.lastCheckpointId
        etInput.setText(savedPackage.goal)
        tvConversation.text = ""
        appendConversation("[AGENT] resuming from saved task package: ${savedPackage.id}")
        agentLoop = buildAgentLoop()
        loopJob = lifecycleScope.launch { agentLoop.resume(savedPackage, checkpointId) }
    }

    private fun observeState() {
        lifecycleScope.launch {
            agentLoop.log.collect { entry ->
                appendConversation(entry)
            }
        }
    }

    private fun buildAgentLoop(): AgentLoop {
        return AgentLoop(
            goalProvider = { etInput.text.toString() },
            baseBranchProvider = { settingsStore.load().github.baseBranch.ifBlank { "main" } },
            stopAfterPlanningProvider = { runtimeState.mode == RuntimeMode.PLAN },
            planRequest = planRequest@{ request ->
                val settings = settingsStore.load()
                if (!settings.provider.isComplete) {
                    return@planRequest AgentLoop.ScriptedProvider().ask(request)
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

    private fun submitAsk(prompt: String) {
        if (activeTabIndex in tabs.indices) {
            val tab = tabs[activeTabIndex]
            if (tab.askHistory.isEmpty() && tab.name.startsWith("Chat ")) {
                val short = prompt.take(24).replace("\n", " ").trim()
                tabs[activeTabIndex] = tab.copy(name = short.ifBlank { tab.name })
            }
        }
        askJob = lifecycleScope.launch {
            dispatch(
                RuntimeAction.AskStarted(
                    prompt = prompt,
                    startedAtMs = System.currentTimeMillis(),
                )
            )
            appendConversation("[ASK] sent: $prompt")
            try {
                val result = askModel(prompt)
                dispatch(
                    RuntimeAction.AskCompleted(
                        completedAtMs = System.currentTimeMillis(),
                        response = result,
                    )
                )
                appendConversation("[ASK] done")
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
                appendConversation("[ASK] failed: timeout")
            } catch (error: CancellationException) {
                dispatch(RuntimeAction.AskCancelled(prompt))
                appendConversation("[ASK] cancelled")
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
                appendConversation("[ASK] failed: ${error.message}")
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

    private fun appendConversation(line: String) {
        tvConversation.append("$line\n")
        scrollToBottom()
    }

    private fun scrollToBottom() {
        tvConversation.post {
            (tvConversation.parent as? View)?.let { parent ->
                (parent.parent as? ScrollView)?.fullScroll(View.FOCUS_DOWN)
            }
        }
    }

    private fun renderConversation() {
        when (runtimeState.mode) {
            RuntimeMode.ASK -> {
                if (runtimeState.askHistory.isEmpty()) {
                    tvConversation.text = getString(R.string.ask_placeholder)
                    tvConversation.movementMethod = null
                } else {
                    val ssb = SpannableStringBuilder()
                    runtimeState.askHistory.forEachIndexed { index, turn ->
                        if (index > 0) ssb.append("\n\n")
                        val roleStart = ssb.length
                        val roleText = "${turn.role}:"
                        ssb.append(roleText)
                        ssb.setSpan(StyleSpan(android.graphics.Typeface.BOLD), roleStart, ssb.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                        val color = if (turn.role == "You")
                            ContextCompat.getColor(this, android.R.color.holo_blue_dark)
                        else
                            ContextCompat.getColor(this, android.R.color.holo_green_dark)
                        ssb.setSpan(ForegroundColorSpan(color), roleStart, ssb.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE)
                        ssb.append("\n")
                        ssb.append(turn.content)
                        if (turn.role == "You") {
                            ssb.setSpan(
                                object : ClickableSpan() {
                                    override fun onClick(widget: View) {
                                        etInput.setText(turn.content)
                                        etInput.setSelection(turn.content.length)
                                    }
                                    override fun updateDrawState(ds: TextPaint) {
                                        ds.isUnderlineText = false
                                    }
                                },
                                roleStart, ssb.length, Spannable.SPAN_EXCLUSIVE_EXCLUSIVE,
                            )
                        }
                    }
                    tvConversation.text = ssb
                    tvConversation.movementMethod = LinkMovementMethod.getInstance()
                }
            }
            RuntimeMode.PLAN, RuntimeMode.AGENT, RuntimeMode.ADAPTIVE -> {
                if (tvConversation.text.isBlank()) {
                    tvConversation.text = getString(R.string.agent_log_placeholder)
                    tvConversation.movementMethod = null
                }
            }
        }
        scrollToBottom()
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
        tvModel.text = if (settings.provider.isComplete) {
            settings.provider.model
        } else {
            getString(R.string.summary_provider_offline)
        }
    }

    private fun saveCurrentTab() {
        if (activeTabIndex in tabs.indices) {
            tabs[activeTabIndex] = tabs[activeTabIndex].copy(
                askHistory = runtimeState.askHistory,
                mode = runtimeState.mode,
            )
        }
    }

    private fun switchTab(index: Int) {
        if (index == activeTabIndex || index !in tabs.indices) return
        saveCurrentTab()
        loopJob?.cancel()
        askJob?.cancel()
        loopJob = null
        askJob = null
        activeTabIndex = index
        val tab = tabs[index]
        runtimeState = AppRuntimeState(mode = tab.mode)
        dispatch(RuntimeAction.HydrateAskHistory(tab.askHistory))
        dispatch(RuntimeAction.SwitchMode(tab.mode))
        agentLoop = buildAgentLoop()
        tvConversation.text = ""
    }

    private fun addTab() {
        saveCurrentTab()
        val name = nextTabName()
        tabs.add(ChatTab(name = name))
        switchTab(tabs.lastIndex)
    }

    private fun closeTab(index: Int) {
        if (tabs.size <= 1) return
        tabs.removeAt(index)
        activeTabIndex = when {
            index < activeTabIndex -> activeTabIndex - 1
            index == activeTabIndex -> minOf(activeTabIndex, tabs.lastIndex)
            else -> activeTabIndex
        }
        val tab = tabs[activeTabIndex]
        runtimeState = AppRuntimeState(mode = tab.mode)
        dispatch(RuntimeAction.HydrateAskHistory(tab.askHistory))
        dispatch(RuntimeAction.SwitchMode(tab.mode))
        agentLoop = buildAgentLoop()
        tvConversation.text = ""
    }

    private fun nextTabName(): String {
        val existing = tabs.map { it.name }.toSet()
        var n = 1
        while ("Chat $n" in existing) n++
        return "Chat $n"
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
        val githubToken = textField(getString(R.string.hint_github_token), settings.github.token, true)

        val (githubOwner, githubOwnerBtn, githubOwnerRow) = dropdownRow(
            getString(R.string.hint_github_owner), settings.github.owner
        )
        val (githubRepo, githubRepoBtn, githubRepoRow) = dropdownRow(
            getString(R.string.hint_github_repo), settings.github.repo
        )
        val (githubBaseBranch, githubBaseBranchBtn, githubBaseBranchRow) = dropdownRow(
            getString(R.string.hint_github_base_branch), settings.github.baseBranch
        )

        githubOwnerBtn.setOnClickListener {
            val token = githubToken.text.toString().trim()
            if (token.isBlank()) {
                appendConversation("[CFG] Set GitHub token first")
                return@setOnClickListener
            }
            lifecycleScope.launch {
                githubOwnerBtn.isEnabled = false
                githubOwnerBtn.text = "..."
                val result = withContext(Dispatchers.IO) { GitHubDiscovery.fetchOwners(token) }
                githubOwnerBtn.isEnabled = true
                githubOwnerBtn.text = "▼"
                result.onSuccess { owners ->
                    if (owners.isEmpty()) {
                        appendConversation("[CFG] No owners found")
                        return@launch
                    }
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Select Owner")
                        .setItems(owners.toTypedArray()) { _, which ->
                            githubOwner.setText(owners[which])
                            githubRepo.setText("")
                            githubBaseBranch.setText("")
                        }
                        .setNegativeButton(android.R.string.cancel, null)
                        .show()
                }.onFailure { e ->
                    appendConversation("[CFG] Owner fetch failed: ${e.message}")
                }
            }
        }

        githubRepoBtn.setOnClickListener {
            val token = githubToken.text.toString().trim()
            val owner = githubOwner.text.toString().trim()
            if (token.isBlank()) {
                appendConversation("[CFG] Set GitHub token first")
                return@setOnClickListener
            }
            if (owner.isBlank()) {
                appendConversation("[CFG] Select owner first")
                return@setOnClickListener
            }
            lifecycleScope.launch {
                githubRepoBtn.isEnabled = false
                githubRepoBtn.text = "..."
                val result = withContext(Dispatchers.IO) { GitHubDiscovery.fetchRepos(token, owner) }
                githubRepoBtn.isEnabled = true
                githubRepoBtn.text = "▼"
                result.onSuccess { repos ->
                    if (repos.isEmpty()) {
                        appendConversation("[CFG] No repos found for $owner")
                        return@launch
                    }
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Select Repo")
                        .setItems(repos.toTypedArray()) { _, which ->
                            githubRepo.setText(repos[which])
                            githubBaseBranch.setText("")
                        }
                        .setNegativeButton(android.R.string.cancel, null)
                        .show()
                }.onFailure { e ->
                    appendConversation("[CFG] Repo fetch failed: ${e.message}")
                }
            }
        }

        githubBaseBranchBtn.setOnClickListener {
            val token = githubToken.text.toString().trim()
            val owner = githubOwner.text.toString().trim()
            val repo = githubRepo.text.toString().trim()
            if (token.isBlank()) {
                appendConversation("[CFG] Set GitHub token first")
                return@setOnClickListener
            }
            if (owner.isBlank() || repo.isBlank()) {
                appendConversation("[CFG] Select owner and repo first")
                return@setOnClickListener
            }
            lifecycleScope.launch {
                githubBaseBranchBtn.isEnabled = false
                githubBaseBranchBtn.text = "..."
                val result = withContext(Dispatchers.IO) { GitHubDiscovery.fetchBranches(token, owner, repo) }
                githubBaseBranchBtn.isEnabled = true
                githubBaseBranchBtn.text = "▼"
                result.onSuccess { branches ->
                    if (branches.isEmpty()) {
                        appendConversation("[CFG] No branches found for $owner/$repo")
                        return@launch
                    }
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Select Base Branch")
                        .setItems(branches.toTypedArray()) { _, which ->
                            githubBaseBranch.setText(branches[which])
                        }
                        .setNegativeButton(android.R.string.cancel, null)
                        .show()
                }.onFailure { e ->
                    appendConversation("[CFG] Branch fetch failed: ${e.message}")
                }
            }
        }

        listOf(
            providerBaseUrl,
            providerApiKey,
            providerModel,
            githubToken,
            githubOwnerRow,
            githubRepoRow,
            githubBaseBranchRow,
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
                appendConversation(getString(R.string.log_settings_saved))
            }
            .show()
    }

    private fun dropdownRow(hint: String, value: String): Triple<EditText, Button, LinearLayout> {
        val edit = EditText(this).apply {
            this.hint = hint
            setText(value)
            layoutParams = LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
            )
        }
        val btn = Button(this).apply {
            text = "▼"
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            addView(edit)
            addView(btn)
        }
        return Triple(edit, btn, row)
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
        saveCurrentTab()
        settingsStore.saveTabs(tabs)
        renderRuntimeState()
    }

    private fun renderRuntimeState() {
        renderModeButtons()
        renderConversation()
        renderAgentRecoverySummary()
        runtimeState.recovery.pendingAskPrompt?.let { pending ->
            if (pending.isNotBlank() && etInput.text.isNullOrBlank()) {
                etInput.setText(pending)
                etInput.setSelection(pending.length)
            }
        }
        runtimeState.recovery.pendingAgentGoal?.let { pending ->
            if (pending.isNotBlank() && etInput.text.isNullOrBlank()) {
                etInput.setText(pending)
                etInput.setSelection(pending.length)
            }
        }

        val askBusy = runtimeState.ask is AskSessionState.Streaming
        val agentActive = runtimeState.agent !is AgentSessionState.Idle &&
            runtimeState.agent !is AgentSessionState.Completed
        val busy = askBusy || agentActive
        btnSend.isEnabled = !busy
        btnStop.visibility = if (busy) View.VISIBLE else View.GONE
        etInput.hint = when (runtimeState.mode) {
            RuntimeMode.ASK -> getString(R.string.hint_ask_prompt)
            RuntimeMode.PLAN -> "Enter plan goal..."
            RuntimeMode.AGENT -> getString(R.string.hint_agent_goal)
            RuntimeMode.ADAPTIVE -> "Adaptive mode: enter task..."
        }

        when (runtimeState.mode) {
            RuntimeMode.ASK -> {
                tvStatus.text = when {
                    runtimeState.recovery.needsResume && !runtimeState.recovery.lastRecoveryMessage.isNullOrBlank() ->
                        runtimeState.recovery.lastRecoveryMessage
                    askBusy -> getString(R.string.status_ask_running)
                    !runtimeState.settings.providerReady -> getString(R.string.status_ask_config_needed)
                    else -> getString(R.string.status_ask_ready)
                }
            }
            RuntimeMode.PLAN, RuntimeMode.AGENT -> {
                if (runtimeState.recovery.needsResume && !runtimeState.recovery.lastRecoveryMessage.isNullOrBlank()) {
                    tvStatus.text = runtimeState.recovery.lastRecoveryMessage
                }
                updateAgentUi(runtimeState.agent)
            }
            RuntimeMode.ADAPTIVE -> {
                tvStatus.text = "Adaptive mode ready"
            }
        }
    }

    private fun renderModeButtons() {
        val activeColor = ContextCompat.getColor(this, android.R.color.white)
        val inactiveColor = ContextCompat.getColor(this, android.R.color.darker_gray)
        val activeBg = 0x33FFFFFF.toInt()
        val inactiveBg = 0x00000000

        fun updateBtn(btn: Button, mode: RuntimeMode) {
            val isActive = runtimeState.mode == mode
            btn.setTextColor(if (isActive) activeColor else inactiveColor)
            btn.setBackgroundColor(if (isActive) activeBg else inactiveBg)
            btn.setTypeface(null, if (isActive) android.graphics.Typeface.BOLD else android.graphics.Typeface.NORMAL)
        }

        updateBtn(btnModeAsk, RuntimeMode.ASK)
        updateBtn(btnModePlan, RuntimeMode.PLAN)
        updateBtn(btnModeAgent, RuntimeMode.AGENT)
        updateBtn(btnModeAdaptive, RuntimeMode.ADAPTIVE)
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
        val resume = showResume()
        btnApprove.visibility = if (waiting) View.VISIBLE else View.GONE
        btnReject.visibility = if (waiting) View.VISIBLE else View.GONE
        btnResume.visibility = if (resume) View.VISIBLE else View.GONE
        layoutAgentActions.visibility = if (waiting || resume) View.VISIBLE else View.GONE
    }

    private fun showResume(): Boolean =
        runtimeState.recovery.needsResume &&
        runtimeState.recovery.pendingTaskPackage != null &&
        runtimeState.agent is AgentSessionState.Idle

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
