package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class DeleteToolTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun tool(): DeleteTool = DeleteTool(tmp.root)

    private fun write(rel: String, content: String = "") {
        val f = File(tmp.root, rel)
        f.parentFile?.mkdirs()
        f.writeText(content)
    }

    @Test
    fun deleteToolRemovesFile() = runBlocking {
        write("a.txt", "a")
        val result = tool().invoke(mapOf("path" to "a.txt"))
        assertTrue(result.isSuccess)
        assertTrue(result.output.contains("deleted a.txt"))
        assertFalse(File(tmp.root, "a.txt").exists())
    }

    @Test
    fun deleteToolRequiresPath() = runBlocking {
        val result = tool().invoke(mapOf())
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("requires path"))
    }

    @Test
    fun deleteToolRejectsPathOutsideSandbox() = runBlocking {
        val result = tool().invoke(mapOf("path" to "../outside"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("outside sandbox"))
    }

    @Test
    fun deleteToolRejectsNonExistentPath() = runBlocking {
        val result = tool().invoke(mapOf("path" to "missing.txt"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("not found"))
    }

    @Test
    fun deleteToolRejectsSandboxRoot() = runBlocking {
        val result = tool().invoke(mapOf("path" to "."))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("sandbox root"))
    }

    @Test
    fun deleteToolRejectsNonEmptyDirectory() = runBlocking {
        write("dir/file.txt", "x")
        val result = tool().invoke(mapOf("path" to "dir"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("non-empty directory"))
    }

    @Test
    fun deleteToolRemovesEmptyDirectory() = runBlocking {
        write("dir/.keep", "")
        File(tmp.root, "dir/.keep").delete()
        val result = tool().invoke(mapOf("path" to "dir"))
        assertTrue(result.isSuccess)
        assertTrue(result.output.contains("deleted dir"))
        assertFalse(File(tmp.root, "dir").exists())
    }
}
