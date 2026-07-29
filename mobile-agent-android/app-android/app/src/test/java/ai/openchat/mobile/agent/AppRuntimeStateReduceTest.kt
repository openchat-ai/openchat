package ai.openchat.mobile.agent

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppRuntimeStateReduceTest {

    private val packageFixture = TaskPackage(
        id = "task-1",
        goal = "ship fix",
        createdAtMs = 1L,
        artifactKind = ArtifactKind.MarkdownDraft,
        planSummary = "plan",
        artifacts = listOf(
            Artifact(path = "out.md", mime = "text/markdown", content = "# hi", summary = "s"),
        ),
        checkpoints = listOf(
            Checkpoint(id = "preview-draft", label = "preview", reason = "r", artifactPaths = listOf("out.md")),
            Checkpoint(id = "publish-draft", label = "publish", reason = "r", artifactPaths = listOf("out.md")),
        ),
        publishIntent = PublishIntent(
            baseBranch = "main",
            branchName = "mobile-agent/x",
            commitMessage = "msg",
            prTitle = "t",
            prBody = "b",
        ),
        rollbackHints = emptyList(),
    )

    private val recovered = AppRuntimeState(
        recovery = RecoveryState(
            needsResume = true,
            pendingAgentGoal = "ship fix",
            pendingTaskPackage = packageFixture,
            lastCheckpointId = "preview-draft",
            lastRecoveryMessage = "interrupted",
        ),
    )

    @Test
    fun observeIdle_keepsRecovery() {
        val next = recovered.reduce(RuntimeAction.ObserveAgent(AgentSessionState.Idle))
        assertTrue(next.recovery.needsResume)
        assertEquals(packageFixture, next.recovery.pendingTaskPackage)
        assertEquals("preview-draft", next.recovery.lastCheckpointId)
        assertEquals(AgentSessionState.Idle, next.agent)
    }

    @Test
    fun observeCompleted_clearsRecovery() {
        val completed = AgentSessionState.Completed(packageFixture, summary = "done")
        val next = recovered.reduce(RuntimeAction.ObserveAgent(completed))
        assertFalse(next.recovery.needsResume)
        assertNull(next.recovery.pendingTaskPackage)
        assertNull(next.lastError)
    }

    @Test
    fun agentFailed_keepsPackageAndNeedsResume() {
        val error = AppError(
            kind = ErrorKind.Unknown,
            code = "PUBLISH",
            message = "boom",
            retryable = true,
            occurredAtMs = 2L,
            stateSnapshot = "s",
        )
        val next = AppRuntimeState().reduce(
            RuntimeAction.AgentFailed(
                error = error,
                goal = "ship fix",
                taskPackage = packageFixture,
                checkpointId = "publish-draft",
            ),
        )
        assertEquals(AgentSessionState.Idle, next.agent)
        assertTrue(next.recovery.needsResume)
        assertEquals(packageFixture, next.recovery.pendingTaskPackage)
        assertEquals("publish-draft", next.recovery.lastCheckpointId)
        assertEquals("boom", next.recovery.lastRecoveryMessage)
        assertEquals(error, next.lastError)
    }

    @Test
    fun clearRecovery_wipesPackage() {
        val next = recovered.reduce(RuntimeAction.ClearRecovery())
        assertFalse(next.recovery.needsResume)
        assertNull(next.recovery.pendingTaskPackage)
        assertNull(next.lastError)
    }
}
