package ai.openchat.mobile.agent.core.agent

import ai.openchat.mobile.agent.Artifact
import ai.openchat.mobile.agent.ArtifactKind
import ai.openchat.mobile.agent.Checkpoint
import ai.openchat.mobile.agent.PublishIntent
import ai.openchat.mobile.agent.TaskPackage
import ai.openchat.mobile.agent.core.modelrouter.ModelResponse
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class AgentLoopSingleFlightTest {

    private fun fixture(goal: String = "demo goal") = TaskPackage(
        id = "task-sf",
        goal = goal,
        createdAtMs = 1L,
        artifactKind = ArtifactKind.MarkdownDraft,
        planSummary = "plan",
        artifacts = listOf(
            Artifact(
                path = "mobile-agent-output/demo.md",
                mime = "text/markdown",
                content = "# demo\n",
                summary = "s",
            ),
        ),
        checkpoints = listOf(
            Checkpoint(
                id = "preview-draft",
                label = "preview",
                reason = "r",
                artifactPaths = listOf("mobile-agent-output/demo.md"),
            ),
            Checkpoint(
                id = "publish-draft",
                label = "publish",
                reason = "r",
                artifactPaths = listOf("mobile-agent-output/demo.md"),
            ),
        ),
        publishIntent = PublishIntent(
            baseBranch = "main",
            branchName = "mobile-agent/demo",
            commitMessage = "msg",
            prTitle = "t",
            prBody = "b",
        ),
        rollbackHints = emptyList(),
    )

    private suspend fun awaitWaiting(loop: AgentLoop) {
        withTimeout(5_000) {
            while (loop.state.value != AgentState.WAITING) {
                delay(10)
            }
        }
    }

    @Test
    fun resume_doesNotCallPlanner() = runBlocking {
        val planCalls = AtomicInteger(0)
        val events = mutableListOf<AgentLifecycleEvent>()
        val loop = AgentLoop(
            planRequest = {
                planCalls.incrementAndGet()
                ModelResponse(text = "# should not plan\n")
            },
            publishDraft = { "published" },
            onLifecycleEvent = { events.add(it) },
        )

        val job = launch { loop.resume(fixture(), fromCheckpointId = "preview-draft") }
        withTimeout(5_000) {
            loop.log.first { it.contains("[C1.resume]") }
        }

        // preview + publish + summarize each require approval
        repeat(3) {
            awaitWaiting(loop)
            loop.approve()
            yield() // let the loop coroutine consume the approval before the next iteration
        }
        job.join()

        assertEquals(0, planCalls.get())
        assertFalse(events.any { it is AgentLifecycleEvent.Planning })
        assertTrue(events.any { it is AgentLifecycleEvent.Completed })
    }

    @Test
    fun retry_requeuesCheckpoint_andSucceedsWithinLimit() = runBlocking {
        val publishCalls = AtomicInteger(0)
        val events = mutableListOf<AgentLifecycleEvent>()
        val loop = AgentLoop(
            planRequest = { ModelResponse(text = "# plan\n") },
            publishDraft = {
                val n = publishCalls.incrementAndGet()
                if (n <= 2) throw RuntimeException("publish boom $n") else "published"
            },
            onLifecycleEvent = { events.add(it) },
        )

        val job = launch { loop.resume(fixture(), fromCheckpointId = "preview-draft") }
        withTimeout(5_000) {
            loop.log.first { it.contains("[C1.resume]") }
        }

        repeat(5) {
            awaitWaiting(loop)
            loop.approve()
            yield()
        }
        job.join()

        assertEquals(3, publishCalls.get())
        val retryable = events.filterIsInstance<AgentLifecycleEvent.Failed>().filter { it.retryable }
        assertEquals(2, retryable.size)
        assertTrue(retryable.all { it.checkpointId == "publish-draft" })
        assertTrue(events.any { it is AgentLifecycleEvent.Completed })
        val retryLog = withTimeout(5_000) {
            loop.log.first { it.contains("[C5.retry] checkpoint publish-draft attempt 2/3") }
        }
        assertTrue(retryLog.contains("[C5.retry] checkpoint publish-draft attempt 2/3"))
    }

    @Test
    fun retry_exhausts_afterThreeFailures() = runBlocking {
        val publishCalls = AtomicInteger(0)
        val events = mutableListOf<AgentLifecycleEvent>()
        val loop = AgentLoop(
            planRequest = { ModelResponse(text = "# plan\n") },
            publishDraft = {
                publishCalls.incrementAndGet()
                throw RuntimeException("publish boom")
            },
            onLifecycleEvent = { events.add(it) },
        )

        val job = launch { loop.resume(fixture(), fromCheckpointId = "preview-draft") }
        withTimeout(5_000) {
            loop.log.first { it.contains("[C1.resume]") }
        }

        repeat(6) {
            awaitWaiting(loop)
            loop.approve()
            yield()
        }
        job.join()

        assertEquals(4, publishCalls.get())
        val retryable = events.filterIsInstance<AgentLifecycleEvent.Failed>().filter { it.retryable }
        assertEquals(3, retryable.size)
        assertTrue(retryable.all { it.checkpointId == "publish-draft" })
        val exhausted = events.filterIsInstance<AgentLifecycleEvent.Failed>().first { !it.retryable }
        assertEquals("retry-exhausted", exhausted.stage)
        assertEquals("publish-draft", exhausted.checkpointId)
        assertTrue(events.none { it is AgentLifecycleEvent.Completed })
        val exhaustedLog = withTimeout(5_000) {
            loop.log.first { it.contains("[E5] checkpoint publish-draft failed after 3 attempts") }
        }
        assertTrue(exhaustedLog.contains("[E5] checkpoint publish-draft failed after 3 attempts"))
    }
}
