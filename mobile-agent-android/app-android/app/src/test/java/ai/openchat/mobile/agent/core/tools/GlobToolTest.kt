package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class GlobToolTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun tool(): GlobTool = GlobTool(tmp.root)

    private fun write(rel: String, content: String = "") {
        val f = File(tmp.root, rel)
        f.parentFile?.mkdirs()
        f.writeText(content)
    }

    @Test
    fun findsFilesMatchingPattern() = runBlocking {
        write("src/a.kt", "alpha\n")
        write("src/b.kt", "beta\n")
        write("other/c.java", "gamma\n")
        val result = tool().invoke(mapOf("pattern" to "src/*.kt"))
        assertTrue(result.output.contains("src/a.kt"))
        assertTrue(result.output.contains("src/b.kt"))
        assertTrue(!result.output.contains("other/c.java"))
        assertTrue(result.error == null)
    }

    @Test
    fun findsAllFilesWithRecursivePattern() = runBlocking {
        write("a.kt", "alpha\n")
        write("dir/b.kt", "beta\n")
        write("dir/sub/c.kt", "gamma\n")
        val result = tool().invoke(mapOf("pattern" to "**/*.kt"))
        assertTrue(result.output.contains("a.kt"))
        assertTrue(result.output.contains("dir/b.kt"))
        assertTrue(result.output.contains("dir/sub/c.kt"))
    }

    @Test
    fun emptyPatternReturnsError() = runBlocking {
        val result = tool().invoke(mapOf("pattern" to ""))
        assertTrue(result.error?.contains("requires pattern") == true)
    }

    @Test
    fun blankPatternReturnsError() = runBlocking {
        val result = tool().invoke(mapOf("pattern" to "  "))
        assertTrue(result.error?.contains("requires pattern") == true)
    }

    @Test
    fun sandboxEscapeRejected() = runBlocking {
        val result = tool().invoke(mapOf("pattern" to "**/*.txt", "path" to "../outside"))
        assertTrue(result.error?.contains("outside sandbox") == true)
    }

    @Test
    fun noMatchesReportsClearly() = runBlocking {
        write("a.kt", "content\n")
        val result = tool().invoke(mapOf("pattern" to "**/*.xyz"))
        assertTrue(result.output.contains("No files found"))
    }

    @Test
    fun pathFilterWorks() = runBlocking {
        write("src/a.kt")
        write("other/b.kt")
        val result = tool().invoke(mapOf("pattern" to "*.kt", "path" to "src"))
        assertTrue(result.output.contains("src/a.kt"))
        assertTrue(!result.output.contains("other/b.kt"))
    }
}