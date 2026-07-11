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
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.RecyclerView
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.bottomsheet.BottomSheetDialog
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
import ai.openchat.mobile.agent.core.agent.AgentLifecycleEvent
import ai.openchat.mobile.agent.core.agent.AgentLoop
import ai.openchat.mobile.agent.core.github.CommitFile
import ai.openchat.mobile.agent.core.github.GitHubClient
import ai.openchat.mobile.agent.core.github.GitHubDiscovery
import ai.openchat.mobile.agent.core.modelrouter.ModelMessage
import ai.openchat.mobile.agent.core.modelrouter.ModelRequest
import ai.openchat.mobile.agent.core.modelrouter.ModelResponse
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
    private lateinit var rvConversation: RecyclerView
    private lateinit var tvAgentRecoverySummary: TextView
    private lateinit var tvModel: TextView
    private lateinit var etInput: EditText
    private lateinit var btnSend: Button
    private lateinit var btnResume: Button
    private lateinit var btnSettings: Button
    private lateinit var btnStop: Button
    private lateinit var btnModeAsk: Button
    private lateinit var btnModePlan: Button
    private lateinit var btnModeAgent: Button
    private lateinit var btnModeAdaptive: Button
    private lateinit var layoutAgentActions: View

    private lateinit var settingsStore: AppSettingsStore
    private var loopJob: Job? = null
    private var askJob: Job? = null
    private lateinit var persistenceManager: ai.openchat.mobile.agent.core.persistence.PersistenceManager
    private val runtimeStateFlow = MutableStateFlow(AppRuntimeState())
    private var runtimeState: AppRuntimeState
        get() = runtimeStateFlow.value
        set(value) {
            runtimeStateFlow.value = value
            persistenceManager.save(value)
        }
    private val tabs = mutableListOf<ChatTab>()
    private var activeTabIndex = 0

    private val chatMessages = mutableListOf<ChatMessage>()
    private lateinit var messageAdapter: MessageAdapter
    private var approvalSheet: BottomSheetDialog? = null

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (!isGranted) {
            appendConversation("[WARN] Notification permission denied. Background tasks may be interrupted.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }

        settingsStore = AppSettingsStore(this)
        persistenceManager = ai.openchat.mobile.agent.core.persistence.PersistenceManager(this)

        tvStatus = findViewById(R.id.tvStatus)
        rvConversation = findViewById(R.id.rvConversation)
        tvAgentRecoverySummary = findViewById(R.id.tvAgentRecoverySummary)

        messageAdapter = MessageAdapter(chatMessages)
        rvConversation.layoutManager = LinearLayoutManager(this).apply {
            stackFromEnd = true
        }
        rvConversation.adapter = messageAdapter
        tvModel = findViewById(R.id.tvModel)
        etInput = findViewById(R.id.etInput)
        btnSend = findViewById(R.id.btnSend)
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
        btnResume.setOnClickListener { resumeAgent() }
        btnSettings.setOnClickListener { showSettingsDialog() }
        btnStop.setOnClickListener { stopRunning() }
        tvModel.setOnClickListener { showSettingsDialog() }

        val savedTabs = settingsStore.loadTabs()
        tabs.addAll(savedTabs.ifEmpty { listOf(ChatTab(name = "Chat 1")) })
        activeTabIndex = 0
        
        val history = persistenceManager.loadHistory()
        val snapshot = persistenceManager.loadSnapshot()
        
        if (history != null) {
            dispatch(RuntimeAction.HydrateAskHistory(history))
        } else {
            dispatch(RuntimeAction.HydrateAskHistory(tabs[0].askHistory))
        }

        if (snapshot != null) {
            dispatch(RuntimeAction.HydratePersistence(snapshot))
        } else {
            runtimeState = runtimeState.copy(mode = tabs[0].mode)
        }

        renderSettingsSummary()
        observeAgentStatus()
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
        lifecycleScope.launch {
            ai.openchat.mobile.agent.core.agent.AgentStatusHub.sendCommand(ai.openchat.mobile.agent.core.agent.AgentCommand.Stop)
        }
        if (runtimeState.agent !is AgentSessionState.Idle) {
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
        }
    }

    private fun toggleAgent(goal: String) {
        if (runtimeState.agent !is AgentSessionState.Idle && runtimeState.agent !is AgentSessionState.Completed) {
            lifecycleScope.launch {
                ai.openchat.mobile.agent.core.agent.AgentStatusHub.sendCommand(ai.openchat.mobile.agent.core.agent.AgentCommand.Stop)
            }
        } else {
            chatMessages.clear()
            messageAdapter.notifyDataSetChanged()
            val intent = Intent(this, AgentService::class.java).apply {
                action = AgentService.ACTION_START
                putExtra("goal", goal)
            }
            startService(intent)
        }
    }

    private fun resumeAgent() {
        val savedPackage = runtimeState.recovery.pendingTaskPackage ?: return
        etInput.setText(savedPackage.goal)
        chatMessages.clear()
        messageAdapter.notifyDataSetChanged()
        
        val intent = Intent(this, AgentService::class.java).apply {
            action = AgentService.ACTION_RESUME
            // PersistenceManager handles saving/restoring the TaskPackage
        }
        startService(intent)
    }

    private fun observeAgentStatus() {
        lifecycleScope.launch {
            ai.openchat.mobile.agent.core.agent.AgentStatusHub.state.collect { state ->
                dispatch(RuntimeAction.ObserveAgent(state))
            }
        }
        lifecycleScope.launch {
            ai.openchat.mobile.agent.core.agent.AgentStatusHub.log.collect { entry ->
                appendConversation(entry)
            }
        }
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
        val text = line.trim()
        if (text.isEmpty()) return
        chatMessages.add(ChatMessage(MessageType.LOG, text))
        messageAdapter.notifyItemInserted(chatMessages.size - 1)
        scrollToBottom()
    }

    private fun scrollToBottom() {
        if (chatMessages.isNotEmpty()) {
            rvConversation.scrollToPosition(chatMessages.size - 1)
        }
    }

    private fun renderConversation() {
        when (runtimeState.mode) {
            RuntimeMode.ASK -> {
                val newMessages = runtimeState.askHistory.map { turn ->
                    ChatMessage(
                        type = if (turn.role == "You") MessageType.USER else MessageType.AGENT,
                        content = turn.content,
                        role = turn.role
                    )
                }
                if (chatMessages != newMessages) {
                    chatMessages.clear()
                    chatMessages.addAll(newMessages)
                    messageAdapter.notifyDataSetChanged()
                }
            }
            else -> {
                // Keep logs as they are
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
        if (!settings.provider.isComplete) {
            tvModel.text = getString(R.string.status_ask_config_needed)
            tvModel.setTextColor(ContextCompat.getColor(this, android.R.color.holo_red_dark))
        } else {
            tvModel.text = settings.provider.model
            tvModel.setTextColor(ContextCompat.getColor(this, android.R.color.white))
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
        chatMessages.clear()
        messageAdapter.notifyDataSetChanged()
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
        chatMessages.clear()
        messageAdapter.notifyDataSetChanged()
    }

    private fun nextTabName(): String {
        val existing = tabs.map { it.name }.toSet()
        var n = 1
        while ("Chat $n" in existing) n++
        return "Chat $n"
    }

    private fun showSettingsDialog() {
        val settings = settingsStore.load()
        val view = layoutInflater.inflate(R.layout.dialog_settings, null)
        
        val etProviderBaseUrl = view.findViewById<EditText>(R.id.etProviderBaseUrl).apply { setText(settings.provider.baseUrl) }
        val etProviderApiKey = view.findViewById<EditText>(R.id.etProviderApiKey).apply { setText(settings.provider.apiKey) }
        val etProviderModel = view.findViewById<EditText>(R.id.etProviderModel).apply { setText(settings.provider.model) }
        val btnVerifyProvider = view.findViewById<Button>(R.id.btnVerifyProvider)
        
        val etGithubToken = view.findViewById<EditText>(R.id.etGithubToken).apply { setText(settings.github.token) }
        val etGithubOwner = view.findViewById<EditText>(R.id.etGithubOwner).apply { setText(settings.github.owner) }
        val btnFetchRepos = view.findViewById<Button>(R.id.btnFetchRepos)
        val etGithubRepo = view.findViewById<EditText>(R.id.etGithubRepo).apply { setText(settings.github.repo) }
        val etGithubBaseBranch = view.findViewById<EditText>(R.id.etGithubBaseBranch).apply { setText(settings.github.baseBranch) }
        val btnFetchBranches = view.findViewById<Button>(R.id.btnFetchBranches)

        btnVerifyProvider.setOnClickListener {
            val baseUrl = etProviderBaseUrl.text.toString().trim()
            val apiKey = etProviderApiKey.text.toString().trim()
            val model = etProviderModel.text.toString().trim()
            if (baseUrl.isBlank() || model.isBlank()) {
                appendConversation(getString(R.string.log_cfg_base_model_required))
                return@setOnClickListener
            }
            lifecycleScope.launch {
                btnVerifyProvider.isEnabled = false
                btnVerifyProvider.text = getString(R.string.status_verifying)
                val p = OpenAiCompatibleProvider(id = "test", config = OpenAiCompatibleConfig(baseUrl, apiKey, model))
                val result = withContext(Dispatchers.IO) { runCatching { p.ask(ModelRequest("Hi")) }.getOrNull() }
                btnVerifyProvider.isEnabled = true
                btnVerifyProvider.text = getString(R.string.action_verify_provider)
                if (result?.isSuccess == true) {
                    appendConversation(getString(R.string.log_cfg_provider_verified, result.text?.take(20) ?: ""))
                } else {
                    appendConversation(getString(R.string.log_cfg_provider_failed, result?.error ?: "Network error"))
                }
            }
        }

        btnFetchRepos.setOnClickListener {
            val token = etGithubToken.text.toString().trim()
            val owner = etGithubOwner.text.toString().trim()
            if (token.isBlank() || owner.isBlank()) {
                appendConversation("[CFG] Token and Owner required")
                return@setOnClickListener
            }
            lifecycleScope.launch {
                btnFetchRepos.isEnabled = false
                btnFetchRepos.text = "..."
                val result = withContext(Dispatchers.IO) { GitHubDiscovery.fetchOwners(token) }
                btnFetchRepos.isEnabled = true
                btnFetchRepos.text = "▼"
                result.onSuccess { owners ->
                    if (owners.isEmpty()) {
                        appendConversation("[CFG] No owners found")
                        return@launch
                    }
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Select Owner")
                        .setItems(owners.toTypedArray()) { _, which ->
                            etGithubOwner.setText(owners[which])
                            etGithubRepo.setText("")
                            etGithubBaseBranch.setText("")
                        }
                        .setNegativeButton(android.R.string.cancel, null)
                        .show()
                }.onFailure { e -> appendConversation("[CFG] Owner fetch failed: ${e.message}") }
            }
        }

        btnFetchBranches.setOnClickListener {
            val token = etGithubToken.text.toString().trim()
            val owner = etGithubOwner.text.toString().trim()
            val repo = etGithubRepo.text.toString().trim()
            if (token.isBlank() || owner.isBlank() || repo.isBlank()) {
                appendConversation("[CFG] Token, Owner and Repo required")
                return@setOnClickListener
            }
            lifecycleScope.launch {
                btnFetchBranches.isEnabled = false
                btnFetchBranches.text = "..."
                val result = withContext(Dispatchers.IO) { GitHubDiscovery.fetchBranches(token, owner, repo) }
                btnFetchBranches.isEnabled = true
                btnFetchBranches.text = "▼"
                result.onSuccess { branches ->
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Select Base Branch")
                        .setItems(branches.toTypedArray()) { _, which ->
                            etGithubBaseBranch.setText(branches[which])
                        }
                        .setNegativeButton(android.R.string.cancel, null)
                        .show()
                }.onFailure { e -> appendConversation("[CFG] Branch fetch failed: ${e.message}") }
            }
        }

        AlertDialog.Builder(this)
            .setTitle(R.string.title_settings)
            .setView(view)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.action_save) { _, _ ->
                settingsStore.save(
                    AppSettings(
                        provider = ProviderSettings(
                            baseUrl = etProviderBaseUrl.text.toString(),
                            apiKey = etProviderApiKey.text.toString(),
                            model = etProviderModel.text.toString(),
                        ),
                        github = GitHubSettings(
                            owner = etGithubOwner.text.toString(),
                            repo = etGithubRepo.text.toString(),
                            token = etGithubToken.text.toString(),
                            baseBranch = etGithubBaseBranch.text.toString(),
                        )
                    )
                )
                renderSettingsSummary()
                appendConversation(getString(R.string.log_settings_saved))
            }
            .show()
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
        val waiting = state is AgentSessionState.AwaitingApproval
        val resume = showResume()
        val running = state !is AgentSessionState.Idle && state !is AgentSessionState.Completed && !waiting

        if (!(runtimeState.recovery.needsResume && !runtimeState.recovery.lastRecoveryMessage.isNullOrBlank())) {
            tvStatus.text = when (state) {
                is AgentSessionState.Idle -> getString(R.string.label_agent_idle)
                is AgentSessionState.Planning -> "Thinking: Analyzing task..."
                is AgentSessionState.AwaitingApproval -> "Waiting: Needs your approval"
                is AgentSessionState.Executing -> "Running: ${state.currentStepLabel}"
                is AgentSessionState.Publishing -> "Publishing: Writing to GitHub..."
                is AgentSessionState.Completed -> "Done: Task finished"
            }
        }
        
        // Disable send while running, show stop button
        btnSend.isEnabled = !running
        btnSend.alpha = if (running) 0.5f else 1.0f
        btnStop.visibility = if (running || waiting) View.VISIBLE else View.GONE
        
        if (waiting) {
            showApprovalSheet(state as AgentSessionState.AwaitingApproval)
        } else {
            approvalSheet?.dismiss()
            approvalSheet = null
        }

        if (!running && !resume && state is AgentSessionState.Idle) {
            stopService(Intent(this, AgentService::class.java))
        }

        btnResume.visibility = if (resume) View.VISIBLE else View.GONE
        layoutAgentActions.visibility = if (resume) View.VISIBLE else View.GONE
    }

    private fun showApprovalSheet(state: AgentSessionState.AwaitingApproval) {
        if (approvalSheet?.isShowing == true) return
        
        val sheet = BottomSheetDialog(this)
        val view = layoutInflater.inflate(R.layout.sheet_agent_approval, null)
        sheet.setContentView(view)
        
        val tvDetails = view.findViewById<TextView>(R.id.tvSheetDetails)
        val btnApprove = view.findViewById<Button>(R.id.btnSheetApprove)
        val btnReject = view.findViewById<Button>(R.id.btnSheetReject)
        
        tvDetails.text = buildString {
            append("Checkpoint: ${state.currentCheckpoint.label}\n")
            append("Artifacts:\n")
            state.taskPackage.artifacts.forEach { art ->
                append("- ${art.path} (${art.mime})\n")
            }
        }
        
        btnApprove.setOnClickListener {
            lifecycleScope.launch {
                ai.openchat.mobile.agent.core.agent.AgentStatusHub.sendCommand(ai.openchat.mobile.agent.core.agent.AgentCommand.Approve)
            }
            sheet.dismiss()
        }
        btnReject.setOnClickListener {
            lifecycleScope.launch {
                ai.openchat.mobile.agent.core.agent.AgentStatusHub.sendCommand(ai.openchat.mobile.agent.core.agent.AgentCommand.Reject)
            }
            sheet.dismiss()
        }
        
        approvalSheet = sheet
        sheet.show()
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
