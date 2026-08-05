package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class BashToolTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun tool(): BashTool = BashTool(tmp.root)

    @Test
    fun emptyCommandReturnsError() = runBlocking {
        val result = tool().invoke(mapOf("command" to ""))
        assertTrue(result.error?.contains("requires command") == true)
    }

    @Test
    fun blankCommandReturnsError() = runBlocking {
        val result = tool().invoke(mapOf("command" to "  "))
        assertTrue(result.error?.contains("requires command") == true)
    }

    @Test
    fun simpleEchoReturnsOutput() = runBlocking {
        val result = tool().invoke(mapOf("command" to "echo hello"))
        assertTrue(result.output.contains("hello"))
        assertTrue(result.error == null)
    }

    @Test
    fun nonZeroExitCodeSetsError() = runBlocking {
        val result = tool().invoke(mapOf("command" to "exit 1"))
        assertTrue(result.error?.contains("exited with code 1") == true)
    }

    @Test
    fun workdirOutsideSandboxRejected() = runBlocking {
        val result = tool().invoke(mapOf("command" to "pwd", "workdir" to "../outside"))
        assertTrue(result.error?.contains("outside sandbox") == true)
    }

    @Test
    fun timeoutTooLargeRejected() = runBlocking {
        val result = tool().invoke(mapOf("command" to "echo hi", "timeout" to "400"))
        assertTrue(result.error?.contains("exceeds maximum") == true)
    }

    @Test
    fun timeoutZeroRejected() = runBlocking {
        val result = tool().invoke(mapOf("command" to "echo hi", "timeout" to "0"))
        assertTrue(result.error?.contains("must be >= 1s") == true)
    }
}