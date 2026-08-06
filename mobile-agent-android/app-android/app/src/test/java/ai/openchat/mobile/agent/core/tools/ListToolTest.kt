package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ListToolTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun tool(): ListTool = ListTool(tmp.root)

    private fun write(rel: String, content: String = "") {
        val f = File(tmp.root, rel)
        f.parentFile?.mkdirs()
        f.writeText(content)
    }

    @Test
    fun listToolHandlesDirectory() = runBlocking {
        write("a.txt", "a")
        write("b.txt", "b")
        val result = tool().invoke(mapOf("path" to "."))
        assertTrue(result.isSuccess)
        assertTrue(result.output.contains("[FILE] a.txt"))
        assertTrue(result.output.contains("[FILE] b.txt"))
    }

    @Test
    fun listToolHandlesNonExistentPath() = runBlocking {
        val result = tool().invoke(mapOf("path" to "nonexistent"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("not found"))
    }

    @Test
    fun listToolHandlesMissingPath() = runBlocking {
        val result = tool().invoke(mapOf("recursive" to "true"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("path"))
    }

    @Test
    fun listToolRejectsPathOutsideSandbox() = runBlocking {
        val result = tool().invoke(mapOf("path" to "../outside"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("outside sandbox"))
    }

    @Test
    fun listToolRejectsFileAsDirectory() = runBlocking {
        write("test.txt", "hello")
        val result = tool().invoke(mapOf("path" to "test.txt"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("not a directory"))
    }

    @Test
    fun listToolHandlesSubdirectory() = runBlocking {
        write("dir/nested/file.txt", "content")
        val result = tool().invoke(mapOf("path" to "dir"))
        assertTrue(result.isSuccess)
        assertTrue(result.output.contains("[DIR] nested"))
    }

    @Test
    fun listToolHandlesRecursiveMode() = runBlocking {
        write("dir/sub/file.txt", "content")
        val result = tool().invoke(mapOf("path" to ".", "recursive" to "true"))
        assertTrue(result.isSuccess)
        assertTrue(result.output.contains("[DIR] dir"))
        assertTrue(result.output.contains("[FILE] file.txt"))
    }
}
