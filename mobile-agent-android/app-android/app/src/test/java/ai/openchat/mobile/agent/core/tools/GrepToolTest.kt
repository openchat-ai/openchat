package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class GrepToolTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun tool(): GrepLocalTool = GrepLocalTool(tmp.root)

    private fun write(rel: String, content: String) {
        val f = File(tmp.root, rel)
        f.parentFile?.mkdirs()
        f.writeText(content)
    }

    @Test
    fun findsMatchWithRelPathAndLineNumber() = runBlocking {
        write("src/a.kt", "alpha\nbeta target here\ngamma\n")
        val result = tool().invoke(mapOf("pattern" to "target"))
        assertEquals("src/a.kt:2: beta target here", result.output)
    }

    @Test
    fun pathFilterLimitsSearch() = runBlocking {
        write("src/a.kt", "needle\n")
        write("other/b.kt", "needle\n")
        val result = tool().invoke(mapOf("pattern" to "needle", "path" to "src"))
        assertTrue(result.output.contains("src/a.kt:1"))
        assertTrue(!result.output.contains("other/b.kt"))
    }

    @Test
    fun sandboxEscapeRejected() = runBlocking {
        val result = tool().invoke(mapOf("pattern" to "x", "path" to "../outside"))
        assertTrue(result.error?.contains("outside sandbox") == true)
    }

    @Test
    fun blankPatternRejected() = runBlocking {
        val result = tool().invoke(mapOf("pattern" to "  "))
        assertTrue(result.error?.contains("requires pattern") == true)
    }

    @Test
    fun noMatchesReportsClearly() = runBlocking {
        write("a.kt", "nothing here\n")
        val result = tool().invoke(mapOf("pattern" to "zzz"))
        assertTrue(result.output.contains("no matches"))
    }

    @Test
    fun largeFileSkipped() = runBlocking {
        write("big.txt", "target ".repeat(200_000))
        val result = tool().invoke(mapOf("pattern" to "target"))
        assertTrue(result.output.contains("no matches"))
    }

    @Test
    fun repoToolShortPatternRejected() = runBlocking {
        val result = GrepRepoTool("o", "r", "t").invoke(mapOf("pattern" to "ab"))
        assertTrue(result.error?.contains(">= 3 chars") == true)
    }
}
