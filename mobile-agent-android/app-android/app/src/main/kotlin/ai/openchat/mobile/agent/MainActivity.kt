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
import ai.openchat.mobile.agent.core.modelrouter.ModelRequest
import ai.openchat.mobile.agent.core.modelrouter.ModelRouter
import ai.openchat.mobile.agent.core.modelrouter.OpenAiCompatibleConfig
import ai.openchat.mobile.agent.core.modelrouter.OpenAiCompatibleProvider
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {

    private lateinit var tvStatus: TextView
    private lateinit var tvConfigSummary: TextView
    private lateinit var tvLog: TextView
    private lateinit var btnStart: Button
    private lateinit var btnApprove: Button
    private lateinit var btnReject: Button
    private lateinit var btnSettings: Button

    private lateinit var settingsStore: AppSettingsStore
    private lateinit var agentLoop: AgentLoop
    private var loopJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        settingsStore = AppSettingsStore(this)
        agentLoop = buildAgentLoop()

        tvStatus = findViewById(R.id.tvStatus)
        tvConfigSummary = findViewById(R.id.tvConfigSummary)
        tvLog = findViewById(R.id.tvLog)
        btnStart = findViewById(R.id.btnStart)
        btnApprove = findViewById(R.id.btnApprove)
        btnReject = findViewById(R.id.btnReject)
        btnSettings = findViewById(R.id.btnSettings)

        btnStart.setOnClickListener { toggleAgent() }
        btnApprove.setOnClickListener { agentLoop.approve() }
        btnReject.setOnClickListener { agentLoop.reject() }
        btnSettings.setOnClickListener { showSettingsDialog() }

        renderSettingsSummary()
        observeState()
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
                updateUi(state)
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
            router.ask(request)
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

    private fun updateUi(state: AgentState) {
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
