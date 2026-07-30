package ai.openchat.mobile.agent.core.agent

data class OrchestrationState(
    val phase: Phase = Phase.SENTINEL,
    val context: RoleContext = RoleContext(goal = ""),
    val milestoneQueue: List<String> = emptyList(),
    val currentMilestoneIndex: Int = 0,
)

enum class Phase {
    SENTINEL,
    EXPLORER,
    ORCHESTRATOR,
    WORKER,
    REVIEWER,
    CRITIC,
    AUDITOR,
    COMPLETE,
    FAILED,
}

class RoleOrchestrator {

    fun next(context: RoleContext): AgentRole {
        val phase = currentPhase(context)
        return when (phase) {
            Phase.SENTINEL -> AgentRole.SENTINEL
            Phase.EXPLORER -> AgentRole.EXPLORER
            Phase.ORCHESTRATOR -> AgentRole.ORCHESTRATOR
            Phase.WORKER -> AgentRole.WORKER
            Phase.REVIEWER -> AgentRole.REVIEWER
            Phase.CRITIC -> AgentRole.CRITIC
            Phase.AUDITOR -> AgentRole.AUDITOR
            Phase.COMPLETE, Phase.FAILED -> error("orchestrator should not be called after terminal phase")
        }
    }

    fun onOutput(context: RoleContext, output: RoleOutput): RoleContext {
        return when (output.role) {
            AgentRole.SENTINEL -> context.copy(sentinelSummary = output.text)
            AgentRole.EXPLORER -> context.copy(explorationResult = output.text)
            AgentRole.ORCHESTRATOR -> context.copy(milestonePlan = output.text)
            AgentRole.WORKER -> context.copy(workerOutput = output.text)
            AgentRole.REVIEWER -> context.copy(reviewResult = output.text)
            AgentRole.CRITIC -> context.copy(criticResult = output.text)
            AgentRole.AUDITOR -> context.copy(auditorResult = output.text)
        }
    }

    fun isComplete(context: RoleContext): Boolean =
        currentPhase(context) == Phase.COMPLETE || currentPhase(context) == Phase.FAILED

    fun isFailed(context: RoleContext): Boolean =
        currentPhase(context) == Phase.FAILED

    fun isTerminalPhase(context: RoleContext): Boolean {
        val phase = currentPhase(context)
        return phase == Phase.COMPLETE || phase == Phase.FAILED
    }

    private fun currentPhase(context: RoleContext): Phase {
        if (context.sentinelSummary.isBlank()) return Phase.SENTINEL
        if (context.sentinelSummary.contains("NEEDS_EXPLORATION: YES") && context.explorationResult.isBlank()) return Phase.EXPLORER
        if (context.milestonePlan.isBlank()) return Phase.ORCHESTRATOR
        if (context.workerOutput.isBlank()) return Phase.WORKER
        if (context.reviewResult.isBlank()) return Phase.REVIEWER
        if (context.criticResult.isBlank()) return Phase.CRITIC
        if (context.auditorResult.isBlank()) return Phase.AUDITOR

        val auditorApproved = context.auditorResult.contains("VERDICT: APPROVE")
        if (auditorApproved) return Phase.COMPLETE
        return Phase.FAILED
    }

    fun milestoneProgress(context: RoleContext): String {
        val audit = context.auditorResult.take(60)
        val review = context.reviewResult.take(60)
        val worker = context.workerOutput.take(60)
        return buildString {
            appendLine("  Sentinel: ${context.sentinelSummary.take(60)}")
            if (context.explorationResult.isNotBlank()) appendLine("  Explorer: ${context.explorationResult.take(60)}")
            if (context.milestonePlan.isNotBlank()) appendLine("  Plan: ${context.milestonePlan.take(60)}")
            if (context.workerOutput.isNotBlank()) appendLine("  Worker: $worker")
            if (context.reviewResult.isNotBlank()) appendLine("  Review: $review")
            if (context.criticResult.isNotBlank()) appendLine("  Critic: ${context.criticResult.take(60)}")
            if (context.auditorResult.isNotBlank()) appendLine("  Audit: $audit")
        }
    }
}
