package ai.openchat.mobile.agent

data class TaskPackage(
    val id: String,
    val goal: String,
    val createdAtMs: Long,
    val artifactKind: ArtifactKind,
    val planSummary: String,
    val artifacts: List<Artifact>,
    val checkpoints: List<Checkpoint>,
    val publishIntent: PublishIntent,
    val rollbackHints: List<String>,
)

enum class ArtifactKind {
    MarkdownDraft,
    JsonConfig,
    KotlinCode,
}

data class Artifact(
    val path: String,
    val mime: String,
    val content: String,
    val summary: String,
)

data class Checkpoint(
    val id: String,
    val label: String,
    val reason: String,
    val artifactPaths: List<String>,
)

data class PublishIntent(
    val baseBranch: String,
    val branchName: String,
    val commitMessage: String,
    val prTitle: String,
    val prBody: String,
)

fun TaskPackage.findCheckpoint(checkpointId: String?): Checkpoint? {
    if (checkpointId.isNullOrBlank()) return null
    return checkpoints.firstOrNull { it.id == checkpointId }
}
