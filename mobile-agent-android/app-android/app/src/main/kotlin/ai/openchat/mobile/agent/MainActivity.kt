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
import ai.openchat.mobile.agent.core.agent.AgentLoop
import ai.openchat.mobile.agent.core.agent.AgentState
import ai.openchat.mobile.agent.core.modelrouter.ModelMessage
import ai.openchat.mobile.agent.core.modelrouter.ModelRequest
import ai.openchat.mobile.agent.core.modelrouter.ModelRouter
import ai.openchat.mobile.agent.core.modelrouter.OpenAiCompatibleConfig
import ai.openchat.mobile.agent.core.modelrouter.OpenAiCompatibleProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private enum class UiMode {
        ASK,
        AGENT,
    }

    private lateinit var tvStatus: TextView
    private lateinit var tvConfigSummary: TextView
    private lateinit var etAskPrompt: EditText
    private lateinit var tvAskResponse: TextView
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
    private var currentMode: UiMode = UiMode.ASK
    private val askHistory = mutableListOf<AskTurn>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        settingsStore = AppSettingsStore(this)
        agentLoop = buildAgentLoop()

        tvStatus = findViewById(R.id.tvStatus)
        tvConfigSummary = findViewById(R.id.tvConfigSummary)
        etAskPrompt = findViewById(R.id.etAskPrompt)
        tvAskResponse = findViewById(R.id.tvAskResponse)
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

        btnModeAsk.setOnClickListener { switchMode(UiMode.ASK) }
        btnModeAgent.setOnClickListener { switchMode(UiMode.AGENT) }
        btnAskClear.setOnClickListener { clearAskHistory() }
        btnAsk.setOnClickListener { submitAsk() }
        btnStart.setOnClickListener { toggleAgent() }
        btnApprove.setOnClickListener { agentLoop.approve() }
        btnReject.setOnClickListener { agentLoop.reject() }
        btnSettings.setOnClickListener { showSettingsDialog() }

        askHistory += settingsStore.loadAskHistory()
        renderSettingsSummary()
        renderAskHistory()
        observeState()
        switchMode(UiMode.ASK)
    }

    private fun toggleAgent() {
        if (loopJob?.isActive == true) {
            loopJob?.cancel()
        } else {
            loopJob = lifecycleScope.launch { agentLoop.run() }
        }
    }

    private fun observeState() {
        lifecycleScope.launch {
            agentLoop.state.collect { state ->
                if (currentMode == UiMode.AGENT) {
                    updateAgentUi(state)
                }
            }
        }
        lifecycleScope.launch {
            agentLoop.log.collect { entry ->
                tvLog.append("$entry\n")
            }
        }
    }

    private fun buildAgentLoop(): AgentLoop {
        return AgentLoop { request ->
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
        }
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
            setAskBusy(true)
            appendAskTurn(role = "You", content = prompt)
            appendAskTurn(role = "Assistant", content = "")
            etAskPrompt.setText("")
            tvLog.append(getString(R.string.log_ask_sent) + "\n")
            try {
                val result = askModel(prompt)
                replaceLastAskTurn(role = "Assistant", content = result)
                tvLog.append(getString(R.string.log_ask_done) + "\n")
            } catch (error: IllegalStateException) {
                val errorMessage = error.message ?: getString(R.string.log_ask_failed)
                removeTrailingAssistantPlaceholder()
                appendAskTurn(role = "System", content = errorMessage)
                tvLog.append(getString(R.string.log_ask_failed) + ": ${error.message}\n")
            } finally {
                setAskBusy(false)
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

        val response = withContext(Dispatchers.IO) {
            provider.streamAsk(
                ModelRequest(
                    prompt = prompt,
                    messages = askHistory
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
                        appendAssistantDelta(delta)
                    }
                }
            )
        }

        if (!response.isSuccess) {
            throw IllegalStateException(response.error ?: getString(R.string.log_ask_failed))
        }
        return response.text.orEmpty()
    }

    private fun setAskBusy(isBusy: Boolean) {
        if (currentMode == UiMode.ASK) {
            tvStatus.text = if (isBusy) {
                getString(R.string.status_ask_running)
            } else {
                getString(R.string.status_ask_ready)
            }
        }
        btnAsk.isEnabled = !isBusy
        btnAskClear.isEnabled = !isBusy
        etAskPrompt.isEnabled = !isBusy
        btnModeAgent.isEnabled = !isBusy
    }

    private fun appendAskTurn(role: String, content: String) {
        askHistory += AskTurn(role = role, content = content)
        if (askHistory.size > 12) {
            askHistory.removeAt(0)
        }
        settingsStore.saveAskHistory(askHistory)
        renderAskHistory()
    }

    private fun replaceLastAskTurn(role: String, content: String) {
        if (askHistory.isEmpty()) {
            appendAskTurn(role = role, content = content)
            return
        }
        askHistory[askHistory.lastIndex] = AskTurn(role = role, content = content)
        settingsStore.saveAskHistory(askHistory)
        renderAskHistory()
    }

    private fun appendAssistantDelta(delta: String) {
        if (askHistory.isEmpty()) return
        val last = askHistory.last()
        if (last.role != "Assistant") return
        askHistory[askHistory.lastIndex] = last.copy(content = last.content + delta)
        settingsStore.saveAskHistory(askHistory)
        renderAskHistory()
    }

    private fun removeTrailingAssistantPlaceholder() {
        if (askHistory.lastOrNull()?.role == "Assistant" && askHistory.last().content.isEmpty()) {
            askHistory.removeLast()
            settingsStore.saveAskHistory(askHistory)
            renderAskHistory()
        }
    }

    private fun renderAskHistory() {
        tvAskResponse.text = if (askHistory.isEmpty()) {
            getString(R.string.ask_placeholder)
        } else {
            askHistory.joinToString(separator = "\n\n") { turn ->
                "${turn.role}:\n${turn.content}"
            }
        }
    }

    private fun clearAskHistory() {
        if (askJob?.isActive == true) {
            return
        }
        askHistory.clear()
        settingsStore.saveAskHistory(askHistory)
        renderAskHistory()
        tvStatus.text = getString(R.string.status_ask_history_cleared)
        tvLog.append(getString(R.string.log_ask_cleared) + "\n")
    }

    private fun switchMode(mode: UiMode) {
        currentMode = mode
        panelAsk.visibility = if (mode == UiMode.ASK) View.VISIBLE else View.GONE
        panelAgent.visibility = if (mode == UiMode.AGENT) View.VISIBLE else View.GONE
        btnModeAsk.isEnabled = mode != UiMode.ASK
        btnModeAgent.isEnabled = mode != UiMode.AGENT && askJob?.isActive != true
        if (mode == UiMode.ASK) {
            tvStatus.text = if (askJob?.isActive == true) {
                getString(R.string.status_ask_running)
            } else {
                getString(R.string.status_ask_ready)
            }
        } else {
            updateAgentUi(agentLoop.state.value)
        }
    }

    private fun renderSettingsSummary() {
        val settings = settingsStore.load()
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
                if (currentMode == UiMode.ASK && askJob?.isActive != true) {
                    tvStatus.text = getString(R.string.status_ask_ready)
                }
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

    private fun updateAgentUi(state: AgentState) {
        tvStatus.text = when (state) {
            AgentState.IDLE -> getString(R.string.label_agent_idle)
            AgentState.RUNNING -> getString(R.string.label_agent_running)
            AgentState.WAITING -> getString(R.string.label_agent_waiting)
        }
        val waiting = state == AgentState.WAITING
        btnApprove.visibility = if (waiting) View.VISIBLE else View.GONE
        btnReject.visibility = if (waiting) View.VISIBLE else View.GONE
        btnStart.text = if (state == AgentState.RUNNING || waiting)
            getString(R.string.action_stop)
        else
            getString(R.string.action_start)
    }
}
