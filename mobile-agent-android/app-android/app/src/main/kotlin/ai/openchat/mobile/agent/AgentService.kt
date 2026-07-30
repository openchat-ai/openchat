package ai.openchat.mobile.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import ai.openchat.mobile.agent.core.agent.AgentLoop
import ai.openchat.mobile.agent.core.agent.AgentStatusHub
import ai.openchat.mobile.agent.core.agent.AgentCommand
import ai.openchat.mobile.agent.core.agent.AgentFailure
import ai.openchat.mobile.agent.core.agent.AgentLifecycleEvent
import ai.openchat.mobile.agent.core.modelrouter.ModelRouter
import ai.openchat.mobile.agent.core.modelrouter.OpenAiCompatibleProvider
import ai.openchat.mobile.agent.core.modelrouter.OpenAiCompatibleConfig
import ai.openchat.mobile.agent.core.github.GitHubDiscovery
import ai.openchat.mobile.agent.core.github.GitHubClient
import ai.openchat.mobile.agent.core.github.CommitFile
import ai.openchat.mobile.agent.core.persistence.PersistenceManager
import ai.openchat.mobile.agent.core.tools.ToolRegistry
import ai.openchat.mobile.agent.core.tools.createGitHubTools
import ai.openchat.mobile.agent.core.tools.createLocalFileTools
import ai.openchat.mobile.agent.core.tools.createGitTools
import ai.openchat.mobile.agent.core.tools.CiStatusTool
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// === invariants ===
// - Only one background loop (loopJob) runs at a time
// - Network/plan/publish run on Dispatchers.IO, never Main
// - Failed/Cancelled emit AgentFailure so UI can persist recovery
// - UI state is updated globally via AgentStatusHub

class AgentService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var agentLoop: AgentLoop? = null
    private var loopJob: Job? = null
    private lateinit var settingsStore: AppSettingsStore
    private lateinit var persistenceManager: PersistenceManager

    companion object {
        const val CHANNEL_ID = "agent_service"
        const val NOTIFICATION_ID = 1
        const val ACTION_START = "ai.openchat.mobile.agent.START"
        const val ACTION_RESUME = "ai.openchat.mobile.agent.RESUME"
    }

    override fun onCreate() {
        super.onCreate()
        settingsStore = AppSettingsStore(this)
        persistenceManager = PersistenceManager(this)
        createNotificationChannel()
        observeCommands()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        val goal = intent?.getStringExtra("goal") ?: ""

        if (action == ACTION_START && goal.isNotBlank()) {
            startLoop(goal)
        } else if (action == ACTION_RESUME) {
            val snapshot = persistenceManager.loadSnapshot()
            val tp = snapshot?.recovery?.pendingTaskPackage
            if (tp != null) {
                resumeLoop(tp, snapshot.recovery.lastCheckpointId)
            } else {
                serviceScope.launch {
                    AgentStatusHub.emitLog("[ERROR] Resume failed: No pending task package")
                }
            }
        }

        val notification = createNotification("Agent is starting...")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        return START_NOT_STICKY
    }

    private fun startLoop(goal: String) {
        if (loopJob?.isActive == true) {
            serviceScope.launch {
                AgentStatusHub.emitLog("[C0] start ignored: agent already active")
            }
            return
        }
        agentLoop = buildAgentLoop(goal)
        loopJob = serviceScope.launch(Dispatchers.IO) {
            val self = coroutineContext[Job]
            try {
                agentLoop?.run()
            } finally {
                withContext(Dispatchers.Main.immediate) {
                    if (loopJob === self) {
                        loopJob = null
                        agentLoop = null
                    }
                    stopSelf()
                }
            }
        }
    }

    private fun resumeLoop(taskPackage: TaskPackage, checkpointId: String?) {
        if (loopJob?.isActive == true) {
            serviceScope.launch {
                AgentStatusHub.emitLog("[C0] resume ignored: agent already active")
            }
            return
        }
        agentLoop = buildAgentLoop(taskPackage.goal)
        loopJob = serviceScope.launch(Dispatchers.IO) {
            val self = coroutineContext[Job]
            try {
                agentLoop?.resume(taskPackage, checkpointId)
            } finally {
                withContext(Dispatchers.Main.immediate) {
                    if (loopJob === self) {
                        loopJob = null
                        agentLoop = null
                    }
                    stopSelf()
                }
            }
        }
    }

    private fun buildToolRegistry(): ToolRegistry {
        val registry = ToolRegistry()
        val clientProvider: suspend () -> GitHubClient = {
            val s = settingsStore.load()
            GitHubClient(s.github.owner, s.github.repo, s.github.token)
        }
        val settings = settingsStore.load()
        registry.registerAll(createGitHubTools(clientProvider))
        registry.registerAll(createLocalFileTools(filesDir))
        registry.registerAll(createGitTools(filesDir, clientProvider))
        registry.register(CiStatusTool(settings.github.owner, settings.github.repo, settings.github.token))
        return registry
    }

    private fun buildAgentLoop(goal: String): AgentLoop {
        return AgentLoop(
            goalProvider = { goal },
            baseBranchProvider = { settingsStore.load().github.baseBranch.ifBlank { "main" } },
            stopAfterPlanningProvider = { false },
            maxPlanningRounds = 3,
            planRequest = { request ->
                withContext(Dispatchers.IO) {
                    val settings = settingsStore.load()
                    val router = ModelRouter(
                        listOf(
                            OpenAiCompatibleProvider(
                                "primary",
                                OpenAiCompatibleConfig(
                                    settings.provider.baseUrl,
                                    settings.provider.apiKey,
                                    settings.provider.model,
                                ),
                            ),
                        ),
                    )
                    router.ask(request)
                }
            },
            publishDraft = { taskPackage ->
                withContext(Dispatchers.IO) {
                    val settings = settingsStore.load()
                    val client = GitHubClient(
                        settings.github.owner,
                        settings.github.repo,
                        settings.github.token,
                    )
                    val headSha = client.getBranchHeadSha(taskPackage.publishIntent.baseBranch).getOrThrow()
                    client.createBranch(taskPackage.publishIntent.branchName, headSha).getOrThrow()
                    client.commitFiles(
                        taskPackage.publishIntent.branchName,
                        taskPackage.artifacts.map { CommitFile(it.path, it.content) },
                        taskPackage.publishIntent.commitMessage,
                    ).getOrThrow()
                    val prNum = client.createPullRequest(
                        taskPackage.publishIntent.branchName,
                        taskPackage.publishIntent.baseBranch,
                        taskPackage.publishIntent.prTitle,
                        taskPackage.publishIntent.prBody,
                    ).getOrThrow()
                    "PR #$prNum created"
                }
            },
            onLifecycleEvent = { event ->
                updateStateFromEvent(event)
            },
            repoContext = { "" },
            toolRegistry = buildToolRegistry(),
        ).also { loop ->
            serviceScope.launch {
                loop.log.collect { AgentStatusHub.emitLog(it) }
            }
        }
    }

    private suspend fun updateStateFromEvent(event: AgentLifecycleEvent) {
        when (event) {
            is AgentLifecycleEvent.Failed -> {
                // Do not push Idle here: AgentFailed reducer owns Idle + recovery.
                AgentStatusHub.reportFailure(
                    AgentFailure(
                        goal = event.goal,
                        stage = event.stage,
                        message = event.message,
                        retryable = event.retryable,
                        cancelled = false,
                        taskPackage = event.taskPackage,
                        checkpointId = event.checkpointId,
                    ),
                )
                updateNotification("Failed: ${event.message}")
                return
            }
            is AgentLifecycleEvent.Cancelled -> {
                AgentStatusHub.reportFailure(
                    AgentFailure(
                        goal = event.goal,
                        stage = "cancel",
                        message = "Agent execution interrupted",
                        retryable = true,
                        cancelled = true,
                        taskPackage = event.taskPackage,
                        checkpointId = event.checkpointId,
                    ),
                )
                updateNotification("Cancelled")
                return
            }
            else -> Unit
        }

        val newState = when (event) {
            is AgentLifecycleEvent.Planning ->
                AgentSessionState.Planning(event.goal, System.currentTimeMillis())
            is AgentLifecycleEvent.AwaitingApproval ->
                AgentSessionState.AwaitingApproval(event.taskPackage, event.currentCheckpoint)
            is AgentLifecycleEvent.Executing -> AgentSessionState.Executing(
                taskPackage = event.taskPackage,
                currentCheckpointId = event.currentCheckpointId,
                currentStepLabel = event.stepLabel,
            )
            is AgentLifecycleEvent.Publishing ->
                AgentSessionState.Publishing(event.taskPackage, event.currentCheckpointId)
            is AgentLifecycleEvent.Completed -> {
                updateNotification("Task completed!")
                AgentSessionState.Completed(event.taskPackage, event.summary)
            }
            is AgentLifecycleEvent.Idle -> AgentSessionState.Idle
            is AgentLifecycleEvent.Failed,
            is AgentLifecycleEvent.Cancelled -> return
        }
        AgentStatusHub.updateState(newState)
        if (event !is AgentLifecycleEvent.Completed && event !is AgentLifecycleEvent.Idle) {
            updateNotification(describeEvent(event))
        }
    }

    private fun describeEvent(event: AgentLifecycleEvent): String = when (event) {
        is AgentLifecycleEvent.Planning -> "Planning: ${event.goal}"
        is AgentLifecycleEvent.Executing -> "Executing: ${event.stepLabel}"
        is AgentLifecycleEvent.Publishing -> "Publishing changes..."
        is AgentLifecycleEvent.AwaitingApproval -> "Waiting for approval"
        is AgentLifecycleEvent.Failed -> "Failed: ${event.message}"
        is AgentLifecycleEvent.Cancelled -> "Cancelled"
        else -> "Working..."
    }

    private fun updateNotification(text: String) {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, createNotification(text))
    }

    private fun createNotification(message: String): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("OpenChat Agent")
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_menu_edit)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .build()
    }

    private fun observeCommands() {
        serviceScope.launch {
            AgentStatusHub.commands.collect { command ->
                when (command) {
                    AgentCommand.Approve -> agentLoop?.approve()
                    AgentCommand.Reject -> agentLoop?.reject()
                    AgentCommand.Stop -> {
                        // Prefer graceful reject so Cancelled carries taskPackage.
                        agentLoop?.reject()
                        // If not waiting on approval, cancel the job; Cancelled is emitted from AgentLoop.
                        loopJob?.cancel()
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        loopJob?.cancel()
        loopJob = null
        agentLoop = null
        serviceScope.cancel()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Agent Service Channel",
                NotificationManager.IMPORTANCE_LOW,
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }
}
