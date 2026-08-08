package ai.openchat.mobile.agent.core.tools

import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class GitRepoOpsTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private fun store(): GitRepositoryStore = GitRepositoryStore(tmp.root)

    private fun clientProvider(): suspend () -> Nothing = { error("network should not be touched") }

    @Test
    fun parseRepoUrlAcceptsHttps() {
        val parsed = parseRepoUrl("https://github.com/owner/repo")
        assertEquals("owner", parsed!!.first)
        assertEquals("repo", parsed.second)
    }

    @Test
    fun parseRepoUrlAcceptsShortForm() {
        val parsed = parseRepoUrl("owner/repo")
        assertEquals("owner", parsed!!.first)
        assertEquals("repo", parsed.second)
    }

    @Test
    fun parseRepoUrlAcceptsGitUrl() {
        val parsed = parseRepoUrl("git@github.com:owner/repo.git")
        assertEquals("owner", parsed!!.first)
        assertEquals("repo", parsed.second)
    }

    @Test
    fun parseRepoUrlRejectsInvalid() {
        assertNull(parseRepoUrl("https://github.com"))
        assertNull(parseRepoUrl(""))
        assertNull(parseRepoUrl("   "))
    }

    @Test
    fun initRequiresRepoUrl() = runBlocking {
        val result = GitInitTool(store()).invoke(mapOf())
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("requires repoUrl"))
    }

    @Test
    fun initRejectsInvalidRepoUrl() = runBlocking {
        val result = GitInitTool(store()).invoke(mapOf("repoUrl" to "nonsense"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("invalid repoUrl"))
    }

    @Test
    fun initStoresOwnerAndRepo() = runBlocking {
        val s = store()
        val result = GitInitTool(s).invoke(mapOf("repoUrl" to "owner/repo"))
        assertTrue(result.isSuccess)
        assertEquals("owner", s.owner)
        assertEquals("repo", s.repo)
    }

    @Test
    fun addRequiresPaths() = runBlocking {
        val result = GitAddTool(tmp.root, store()).invoke(mapOf())
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("requires paths"))
    }

    @Test
    fun addStagesFileContent() = runBlocking {
        val s = store()
        File(tmp.root, "a.txt").writeText("hello")
        val result = GitAddTool(tmp.root, s).invoke(mapOf("paths" to "a.txt"))
        assertTrue(result.isSuccess)
        assertEquals("hello", s.staged["a.txt"])
    }

    @Test
    fun addRejectsPathOutsideSandbox() = runBlocking {
        val result = GitAddTool(tmp.root, store()).invoke(mapOf("paths" to "../outside.txt"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("outside sandbox"))
    }

    @Test
    fun addRejectsNonExistentFile() = runBlocking {
        val result = GitAddTool(tmp.root, store()).invoke(mapOf("paths" to "missing.txt"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("not found"))
    }

    @Test
    fun commitRequiresInitFirst() = runBlocking {
        val s = store()
        val result = GitCommitTool(s, clientProvider()).invoke(mapOf("message" to "hi"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("git_init first"))
    }

    @Test
    fun commitRequiresStagedFiles() = runBlocking {
        val s = store()
        GitInitTool(s).invoke(mapOf("repoUrl" to "owner/repo"))
        val result = GitCommitTool(s, clientProvider()).invoke(mapOf("message" to "hi"))
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("git_add first"))
    }

    @Test
    fun commitRequiresMessage() = runBlocking {
        val result = GitCommitTool(store(), clientProvider()).invoke(mapOf())
        assertFalse(result.isSuccess)
        assertTrue(result.error!!.contains("requires message"))
    }
}
