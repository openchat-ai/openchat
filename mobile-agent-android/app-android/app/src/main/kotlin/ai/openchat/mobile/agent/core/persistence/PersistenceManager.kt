package ai.openchat.mobile.agent.core.persistence

import android.content.Context
import android.content.SharedPreferences
import ai.openchat.mobile.agent.AppRuntimeState
import ai.openchat.mobile.agent.RecoveryState
import ai.openchat.mobile.agent.RuntimeMode
import ai.openchat.mobile.agent.RuntimePersistenceSnapshot
import ai.openchat.mobile.agent.TaskPackage
import ai.openchat.mobile.agent.AskTurn
import ai.openchat.mobile.agent.AppError
import ai.openchat.mobile.agent.ErrorKind
import ai.openchat.mobile.agent.Artifact
import ai.openchat.mobile.agent.ArtifactKind
import ai.openchat.mobile.agent.Checkpoint
import ai.openchat.mobile.agent.PublishIntent
import org.json.JSONArray
import org.json.JSONObject

// === invariants ===
// - snapshot key stores mode, recovery, and lastError
// - history key stores the askHistory as a JSON array
// - taskPackage is serialized to JSON embedded in the recovery object

class PersistenceManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("agent_runtime", Context.MODE_PRIVATE)

    fun save(state: AppRuntimeState) {
        val snapshot = RuntimePersistenceSnapshot(
            mode = state.mode,
            recovery = state.recovery,
            lastError = state.lastError
        )
        
        prefs.edit().apply {
            putString("snapshot_v1", serializeSnapshot(snapshot))
            putString("history_v1", serializeHistory(state.askHistory))
            apply()
        }
    }

    fun loadSnapshot(): RuntimePersistenceSnapshot? {
        val raw = prefs.getString("snapshot_v1", null) ?: return null
        return deserializeSnapshot(raw)
    }

    fun loadHistory(): List<AskTurn>? {
        val raw = prefs.getString("history_v1", null) ?: return null
        return deserializeHistory(raw)
    }

    private fun serializeSnapshot(snapshot: RuntimePersistenceSnapshot): String {
        val json = JSONObject()
            .put("mode", snapshot.mode.name)
            .put("recovery", serializeRecovery(snapshot.recovery))
            .put("lastError", snapshot.lastError?.let { serializeError(it) })
        return json.toString()
    }

    private fun deserializeSnapshot(raw: String): RuntimePersistenceSnapshot? = runCatching {
        val json = JSONObject(raw)
        RuntimePersistenceSnapshot(
            mode = RuntimeMode.valueOf(json.getString("mode")),
            recovery = deserializeRecovery(json.getJSONObject("recovery")),
            lastError = json.optJSONObject("lastError")?.let { deserializeError(it) }
        )
    }.getOrNull()

    private fun serializeRecovery(recovery: RecoveryState): JSONObject {
        return JSONObject()
            .put("needsResume", recovery.needsResume)
            .put("pendingAskPrompt", recovery.pendingAskPrompt)
            .put("pendingAgentGoal", recovery.pendingAgentGoal)
            .put("lastCheckpointId", recovery.lastCheckpointId)
            .put("lastRecoveryMessage", recovery.lastRecoveryMessage)
            .put("pendingTaskPackage", recovery.pendingTaskPackage?.let { serializeTaskPackage(it) })
    }

    private fun deserializeRecovery(json: JSONObject): RecoveryState {
        return RecoveryState(
            needsResume = json.getBoolean("needsResume"),
            pendingAskPrompt = json.optString("pendingAskPrompt").takeIf { it != "null" && it.isNotEmpty() },
            pendingAgentGoal = json.optString("pendingAgentGoal").takeIf { it != "null" && it.isNotEmpty() },
            lastCheckpointId = json.optString("lastCheckpointId").takeIf { it != "null" && it.isNotEmpty() },
            lastRecoveryMessage = json.optString("lastRecoveryMessage").takeIf { it != "null" && it.isNotEmpty() },
            pendingTaskPackage = json.optJSONObject("pendingTaskPackage")?.let { deserializeTaskPackage(it) }
        )
    }

    private fun serializeHistory(history: List<AskTurn>): String {
        val array = JSONArray()
        history.forEach { turn ->
            array.put(JSONObject().put("role", turn.role).put("content", turn.content))
        }
        return array.toString()
    }

    private fun deserializeHistory(raw: String): List<AskTurn> = runCatching {
        val array = JSONArray(raw)
        List(array.length()) { i ->
            val obj = array.getJSONObject(i)
            AskTurn(role = obj.getString("role"), content = obj.getString("content"))
        }
    }.getOrDefault(emptyList())

    private fun serializeError(error: AppError): JSONObject {
        return JSONObject().apply {
            put("kind", error.kind.name)
            put("code", error.code)
            put("message", error.message)
            put("retryable", error.retryable)
            put("occurredAtMs", error.occurredAtMs)
            put("stateSnapshot", error.stateSnapshot)
        }
    }

    private fun deserializeError(json: JSONObject): AppError {
        return AppError(
            kind = ErrorKind.valueOf(json.optString("kind", ErrorKind.Unknown.name)),
            code = json.optString("code", "UNKNOWN"),
            message = json.optString("message", ""),
            retryable = json.optBoolean("retryable", false),
            occurredAtMs = json.optLong("occurredAtMs", System.currentTimeMillis()),
            stateSnapshot = json.optString("stateSnapshot", "")
        )
    }

    private fun serializeTaskPackage(tp: TaskPackage): JSONObject {
        return JSONObject()
            .put("id", tp.id)
            .put("goal", tp.goal)
            .put("createdAtMs", tp.createdAtMs)
            .put("artifactKind", tp.artifactKind.name)
            .put("planSummary", tp.planSummary)
            .put("artifacts", JSONArray().apply { 
                tp.artifacts.forEach { this.put(serializeArtifact(it) as Any) } 
            })
            .put("checkpoints", JSONArray().apply { 
                tp.checkpoints.forEach { this.put(serializeCheckpoint(it) as Any) } 
            })
            .put("publishIntent", serializePublishIntent(tp.publishIntent))
            .put("rollbackHints", JSONArray(tp.rollbackHints))
    }

    private fun deserializeTaskPackage(json: JSONObject): TaskPackage {
        return TaskPackage(
            id = json.getString("id"),
            goal = json.getString("goal"),
            createdAtMs = json.getLong("createdAtMs"),
            artifactKind = ArtifactKind.valueOf(json.getString("artifactKind")),
            planSummary = json.getString("planSummary"),
            artifacts = json.getJSONArray("artifacts").let { arr ->
                List(arr.length()) { deserializeArtifact(arr.getJSONObject(it)) }
            },
            checkpoints = json.getJSONArray("checkpoints").let { arr ->
                List(arr.length()) { deserializeCheckpoint(arr.getJSONObject(it)) }
            },
            publishIntent = deserializePublishIntent(json.getJSONObject("publishIntent")),
            rollbackHints = json.getJSONArray("rollbackHints").let { arr ->
                List(arr.length()) { arr.getString(it) }
            }
        )
    }

    private fun serializeArtifact(a: Artifact) = JSONObject()
        .put("path", a.path).put("mime", a.mime).put("content", a.content).put("summary", a.summary)

    private fun deserializeArtifact(j: JSONObject) = Artifact(
        path = j.getString("path"), mime = j.getString("mime"), 
        content = j.getString("content"), summary = j.getString("summary")
    )

    private fun serializeCheckpoint(c: Checkpoint) = JSONObject()
        .put("id", c.id).put("label", c.label).put("reason", c.reason)
        .put("artifactPaths", JSONArray(c.artifactPaths))

    private fun deserializeCheckpoint(j: JSONObject) = Checkpoint(
        id = j.getString("id"), label = j.getString("label"), reason = j.getString("reason"),
        artifactPaths = j.getJSONArray("artifactPaths").let { arr -> List(arr.length()) { arr.getString(it) } }
    )

    private fun serializePublishIntent(p: PublishIntent) = JSONObject()
        .put("baseBranch", p.baseBranch).put("branchName", p.branchName)
        .put("commitMessage", p.commitMessage).put("prTitle", p.prTitle).put("prBody", p.prBody)

    private fun deserializePublishIntent(j: JSONObject) = PublishIntent(
        baseBranch = j.getString("baseBranch"), branchName = j.getString("branchName"),
        commitMessage = j.getString("commitMessage"), prTitle = j.getString("prTitle"), prBody = j.getString("prBody")
    )
}
