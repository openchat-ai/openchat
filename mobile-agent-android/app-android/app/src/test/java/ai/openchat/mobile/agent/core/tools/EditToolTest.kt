package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class EditToolTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun tool(): EditTool = EditTool(tmp.root)

    private fun write(rel: String, content: String = "") {
        val f = File(tmp.root, rel)
        f.parentFile?.mkdirs()
        f.writeText(content)
    }

    @Test
    fun editToolMatchesExactString() = runBlocking {
        write("test.txt", "hello world\nfoo bar")
        val result = tool().invoke(mapOf("path" to "test.txt", "old_string" to "world", "new_string" to "kotlin"))
        assertTrue(result.isSuccess)
        assertEquals("hello kotlin\nfoo bar", File(tmp.root, "test.txt").readText())
    }

    @Test
    fun editToolRejectsMultipleMatches() = runBlocking {
        write("test.txt", "world\nworld")
        val result = tool().invoke(mapOf("path" to "test.txt", "old_string" to "world", "new_string" to "kotlin"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("2 times"))
    }

    @Test
    fun editToolRejectsMissingString() = runBlocking {
        write("test.txt", "hello")
        val result = tool().invoke(mapOf("path" to "test.txt", "old_string" to "missing", "new_string" to "new"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("not found"))
    }

    @Test
    fun editToolRejectsPathOutsideSandbox() = runBlocking {
        val result = tool().invoke(mapOf("path" to "../outside.txt", "old_string" to "a", "new_string" to "b"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("outside sandbox"))
    }

    @Test
    fun editToolRejectsNonExistentFile() = runBlocking {
        val result = tool().invoke(mapOf("path" to "nonexistent.txt", "old_string" to "a", "new_string" to "b"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("not found"))
    }

    @Test
    fun editToolRejectsMissingArgs() = runBlocking {
        val result1 = tool().invoke(mapOf("path" to "test.txt"))
        assertFalse(result1.isSuccess)
        assertTrue(result1.error!!.contains("old_string"))

        val result2 = tool().invoke(mapOf("path" to "test.txt", "old_string" to "a"))
        assertFalse(result2.isSuccess)
        assertTrue(result2.error!!.contains("new_string"))

        val result3 = tool().invoke(mapOf("old_string" to "a", "new_string" to "b"))
        assertFalse(result3.isSuccess)
        assertTrue(result3.error!!.contains("path"))
    }

    @Test
    fun editToolReportsReplacementCount() = runBlocking {
        write("test.txt", "hello")
        val result = tool().invoke(mapOf("path" to "test.txt", "old_string" to "hello", "new_string" to "hi"))
        assertTrue(result.isSuccess)
        assertTrue(result.output.contains("1 occurrence"))
    }
}
