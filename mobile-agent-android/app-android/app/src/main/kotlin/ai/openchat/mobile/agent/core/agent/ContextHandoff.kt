package ai.openchat.mobile.agent.core.agent

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// === invariants ===
// - HandoffState captures the full RoleContext at a point in time
// - writeHandoff() is called before a role LLM call that might exceed context
// - readHandoff() reconstructs the state for the successor agent invocation
// - handoffCount tracks how many times we've handed off (safety limit)

data class HandoffState(
    val goal: String,
    val context: RoleContext,
    val phase: Phase,
    val handoffCount: Int,
    val timestampMs: Long = System.currentTimeMillis(),
)

class ContextHandoff(
    private val handoffDir: File,
    private val maxHandoffs: Int = 5,
) {
    private var handoffCount = 0

    fun shouldHandoff(context: RoleContext): Boolean {
        if (handoffCount >= maxHandoffs) return false
        val serialized = serialize(context)
        return serialized.length > 3000
    }

    fun writeHandoff(context: RoleContext, phase: Phase): String {
        handoffCount++
        val state = HandoffState(
            goal = context.goal,
            context = context,
            phase = phase,
            handoffCount = handoffCount,
        )
        val json = serializeHandoff(state)
        handoffDir.mkdirs()
        val file = File(handoffDir, "handoff-${handoffCount}.json")
        file.writeText(json.toString(2))
        return file.absolutePath
    }

    fun readHandoff(): HandoffState? {
        val files = handoffDir.listFiles()
            ?.filter { it.name.startsWith("handoff-") && it.name.endsWith(".json") }
            ?.sortedBy { it.name }
            ?: return null
        if (files.isEmpty()) return null
        val latest = files.last()
        return try {
            val json = JSONObject(latest.readText())
            deserializeHandoff(json).also {
                handoffCount = it.handoffCount
            }
        } catch (_: Exception) {
            null
        }
    }

    fun clearHandoffs() {
        handoffDir.listFiles()
            ?.filter { it.name.startsWith("handoff-") && it.name.endsWith(".json") }
            ?.forEach { it.delete() }
        handoffCount = 0
    }

    fun handoffSummary(context: RoleContext): String = buildString {
        appendLine("--- CONTEXT HANDOFF (${handoffCount}) ---")
        appendLine("Goal: ${context.goal}")
        if (context.sentinelSummary.isNotBlank()) appendLine("Sentinel: ${context.sentinelSummary.take(100)}")
        if (context.explorationResult.isNotBlank()) appendLine("Explorer: ${context.explorationResult.take(100)}")
        if (context.milestonePlan.isNotBlank()) appendLine("Plan: ${context.milestonePlan.take(100)}")
        if (context.workerOutput.isNotBlank()) appendLine("Worker: ${context.workerOutput.take(100)}")
        if (context.reviewResult.isNotBlank()) appendLine("Review: ${context.reviewResult.take(100)}")
        if (context.criticResult.isNotBlank()) appendLine("Critic: ${context.criticResult.take(100)}")
        if (context.auditorResult.isNotBlank()) appendLine("Audit: ${context.auditorResult.take(100)}")
        appendLine("--- END HANDOFF ---")
    }

    private fun serialize(context: RoleContext): String {
        return JSONObject().apply {
            put("goal", context.goal)
            put("sentinelSummary", context.sentinelSummary)
            put("explorationResult", context.explorationResult)
            put("milestonePlan", context.milestonePlan)
            put("workerOutput", context.workerOutput)
            put("reviewResult", context.reviewResult)
            put("criticResult", context.criticResult)
            put("auditorResult", context.auditorResult)
            put("toolOutputs", JSONObject(context.toolOutputs))
            put("milestoneIndex", context.milestoneIndex)
            put("totalMilestones", context.totalMilestones)
        }.toString()
    }

    private fun deserialize(json: JSONObject): RoleContext {
        return RoleContext(
            goal = json.getString("goal"),
            sentinelSummary = json.optString("sentinelSummary", ""),
            explorationResult = json.optString("explorationResult", ""),
            milestonePlan = json.optString("milestonePlan", ""),
            workerOutput = json.optString("workerOutput", ""),
            reviewResult = json.optString("reviewResult", ""),
            criticResult = json.optString("criticResult", ""),
            auditorResult = json.optString("auditorResult", ""),
            milestoneIndex = json.optInt("milestoneIndex", 0),
            totalMilestones = json.optInt("totalMilestones", 1),
        )
    }

    private fun serializeHandoff(state: HandoffState): JSONObject {
        return JSONObject().apply {
            put("goal", state.goal)
            put("context", serialize(state.context))
            put("phase", state.phase.name)
            put("handoffCount", state.handoffCount)
            put("timestampMs", state.timestampMs)
        }
    }

    private fun deserializeHandoff(json: JSONObject): HandoffState {
        return HandoffState(
            goal = json.getString("goal"),
            context = deserialize(json.getJSONObject("context")),
            phase = Phase.valueOf(json.getString("phase")),
            handoffCount = json.getInt("handoffCount"),
            timestampMs = json.getLong("timestampMs"),
        )
    }
}
