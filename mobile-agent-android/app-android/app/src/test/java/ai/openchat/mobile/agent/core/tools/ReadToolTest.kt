package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ReadToolTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun tool(): ReadTool = ReadTool(tmp.root)

    private fun write(rel: String, content: String = "") {
        val f = File(tmp.root, rel)
        f.parentFile?.mkdirs()
        f.writeText(content)
    }

    @Test
    fun readToolReadsFileContent() = runBlocking {
        write("test.txt", "hello world\nfoo bar")
        val result = tool().invoke(mapOf("path" to "test.txt"))
        assertTrue(result.isSuccess)
        assertEquals("hello world\nfoo bar", result.output)
    }

    @Test
    fun readToolRejectsPathOutsideSandbox() = runBlocking {
        val result = tool().invoke(mapOf("path" to "../outside.txt"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("outside sandbox"))
    }

    @Test
    fun readToolRejectsNonExistentFile() = runBlocking {
        val result = tool().invoke(mapOf("path" to "nonexistent.txt"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("not found"))
    }

    @Test
    fun readToolRejectsDirectory() = runBlocking {
        write("subdir/")
        val result = tool().invoke(mapOf("path" to "subdir"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("not a file"))
    }

    @Test
    fun readToolRejectsMissingPath() = runBlocking {
        val result = tool().invoke(mapOf("content" to "test"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("path"))
    }

    @Test
    fun readToolRejectsEmptyPath() = runBlocking {
        val result = tool().invoke(mapOf("path" to ""))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("path"))
    }

    @Test
    fun readToolHandlesSubdirectory() = runBlocking {
        write("dir/nested/file.txt", "nested content")
        val result = tool().invoke(mapOf("path" to "dir/nested/file.txt"))
        assertTrue(result.isSuccess)
        assertEquals("nested content", result.output)
    }
}
