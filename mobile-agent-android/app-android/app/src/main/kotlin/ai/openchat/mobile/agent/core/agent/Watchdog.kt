package ai.openchat.mobile.agent.core.agent

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.io.FileOutputStream
import java.util.Properties

// === invariants ===
// - Watchdog writes heartbeat at a fixed interval; if not updated within deadline,
//   the agent is considered hung and should be killed
// - Heartbeat is a properties file: lastActiveMs, phase, goal
// - watchdogJob is cancelled when agent completes or is explicitly stopped

class Watchdog(
    private val heartbeatFile: File,
    private val deadlineMs: Long = 120_000L,
    private val heartbeatIntervalMs: Long = 15_000L,
    private val onHung: suspend (goal: String, phase: String) -> Unit = { _, _ -> },
    private val scope: CoroutineScope,
) {
    private var watchdogJob: Job? = null
    private var lastPhase: String = "idle"
    private var lastGoal: String = ""

    fun start(goal: String, phase: String) {
        lastGoal = goal
        lastPhase = phase
        writeHeartbeat(phase)
        watchdogJob = scope.launch {
            try {
                while (isActive) {
                    delay(heartbeatIntervalMs)
                    writeHeartbeat(lastPhase)
                }
            } catch (_: CancellationException) {
            }
        }
    }

    fun updatePhase(phase: String) {
        lastPhase = phase
        writeHeartbeat(phase)
    }

    fun stop() {
        watchdogJob?.cancel()
        watchdogJob = null
        heartbeatFile.delete()
    }

    fun checkHung(): String? {
        if (!heartbeatFile.exists()) return null
        val props = Properties().apply {
            try { load(heartbeatFile.inputStream()) } catch (_: Exception) { return null }
        }
        val lastActive = props.getProperty("lastActiveMs")?.toLongOrNull() ?: return null
        val elapsed = System.currentTimeMillis() - lastActive
        if (elapsed > deadlineMs) {
            return "Watchdog: hung after ${elapsed}ms in phase=${props.getProperty("phase", "?")} goal=${props.getProperty("goal", "?")}"
        }
        return null
    }

    suspend fun processHung() {
        val report = checkHung()
        if (report != null) {
            onHung(lastGoal, lastPhase)
        }
    }

    private fun writeHeartbeat(phase: String) {
        try {
            heartbeatFile.parentFile?.mkdirs()
            val props = Properties()
            props.setProperty("lastActiveMs", System.currentTimeMillis().toString())
            props.setProperty("phase", phase)
            props.setProperty("goal", lastGoal)
            FileOutputStream(heartbeatFile).use { props.store(it, "Watchdog heartbeat") }
        } catch (_: Exception) {
        }
    }
}
