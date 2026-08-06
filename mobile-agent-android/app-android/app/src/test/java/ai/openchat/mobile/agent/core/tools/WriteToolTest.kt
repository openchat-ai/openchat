package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class WriteToolTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun tool(): WriteTool = WriteTool(tmp.root)

    @Test
    fun writeToolCreatesNewFile() = runBlocking {
        val result = tool().invoke(mapOf("path" to "new.txt", "content" to "hello"))
        assertTrue(result.isSuccess)
        assertTrue(result.output.contains("wrote"))
        assertEquals("hello", File(tmp.root, "new.txt").readText())
    }

    @Test
    fun writeToolOverwritesExistingFile() = runBlocking {
        File(tmp.root, "existing.txt").writeText("old content")
        val result = tool().invoke(mapOf("path" to "existing.txt", "content" to "new content"))
        assertTrue(result.isSuccess)
        assertEquals("new content", File(tmp.root, "existing.txt").readText())
    }

    @Test
    fun writeToolRejectsPathOutsideSandbox() = runBlocking {
        val result = tool().invoke(mapOf("path" to "../outside.txt", "content" to "test"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("outside sandbox"))
    }

    @Test
    fun writeToolCreatesParentDirectories() = runBlocking {
        val result = tool().invoke(mapOf("path" to "deep/nested/path/file.txt", "content" to "test"))
        assertTrue(result.isSuccess)
        assertTrue(File(tmp.root, "deep/nested/path/file.txt").exists())
    }

    @Test
    fun writeToolRejectsMissingPath() = runBlocking {
        val result = tool().invoke(mapOf("content" to "test"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("path"))
    }

    @Test
    fun writeToolWritesEmptyContent() = runBlocking {
        val result = tool().invoke(mapOf("path" to "empty.txt"))
        assertTrue(result.isSuccess)
        assertEquals("", File(tmp.root, "empty.txt").readText())
    }

    @Test
    fun writeToolHandlesMultilineContent() = runBlocking {
        val result = tool().invoke(mapOf("path" to "multi.txt", "content" to "line1\nline2\nline3"))
        assertTrue(result.isSuccess)
        assertEquals("line1\nline2\nline3", File(tmp.root, "multi.txt").readText())
    }
}
