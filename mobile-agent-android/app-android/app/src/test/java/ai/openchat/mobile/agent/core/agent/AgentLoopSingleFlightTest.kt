package ai.openchat.mobile.agent.core.agent

import ai.openchat.mobile.agent.Artifact
import ai.openchat.mobile.agent.ArtifactKind
import ai.openchat.mobile.agent.Checkpoint
import ai.openchat.mobile.agent.PublishIntent
import ai.openchat.mobile.agent.TaskPackage
import ai.openchat.mobile.agent.core.modelrouter.ModelResponse
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class AgentLoopSingleFlightTest {

    private val testDispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

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
    fun secondRun_whileActive_isNoOp() = runBlocking {
        val planCalls = AtomicInteger(0)
        val loop = AgentLoop(
            goalProvider = { "single flight goal" },
            planRequest = {
                planCalls.incrementAndGet()
                delay(200)
                ModelResponse(text = "# draft\n")
            },
            publishDraft = { "ok" },
        )

        val first = async { loop.run() }
        withTimeout(5_000) {
            loop.log.first { it.contains("[C1] agent loop started") }
        }
        loop.run()
        withTimeout(5_000) {
            loop.log.first { it.contains("run ignored") }
        }
        // reject only after WAITING; early reject is drained and hangs
        awaitWaiting(loop)
        loop.reject()
        first.await()
        assertEquals(1, planCalls.get())
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
        }
        job.join()

        assertEquals(0, planCalls.get())
        assertFalse(events.any { it is AgentLifecycleEvent.Planning })
        assertTrue(events.any { it is AgentLifecycleEvent.Completed })
    }
}
