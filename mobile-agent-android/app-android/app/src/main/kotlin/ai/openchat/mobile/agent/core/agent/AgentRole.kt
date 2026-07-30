package ai.openchat.mobile.agent.core.agent

enum class AgentRole(val label: String) {
    SENTINEL("Sentinel"),
    EXPLORER("Explorer"),
    ORCHESTRATOR("Orchestrator"),
    WORKER("Worker"),
    REVIEWER("Reviewer"),
    CRITIC("Critic"),
    AUDITOR("Auditor"),
}

data class RoleContext(
    val goal: String,
    val sentinelSummary: String = "",
    val explorationResult: String = "",
    val milestonePlan: String = "",
    val workerOutput: String = "",
    val reviewResult: String = "",
    val criticResult: String = "",
    val auditorResult: String = "",
    val toolOutputs: Map<String, String> = emptyMap(),
    val milestoneIndex: Int = 0,
    val totalMilestones: Int = 1,
)

sealed interface RoleDecision {
    data object Proceed : RoleDecision
    data class NextMilestone(val milestoneGoal: String) : RoleDecision
    data object Complete : RoleDecision
    data class Fail(val reason: String) : RoleDecision
}

data class RoleOutput(
    val role: AgentRole,
    val text: String,
    val decision: RoleDecision = RoleDecision.Proceed,
)
