package ai.openchat.mobile.agent.core.tools

import ai.openchat.mobile.agent.core.github.CommitFile
import ai.openchat.mobile.agent.core.github.GitHubClient
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

fun parseRepoUrl(repoUrl: String): Pair<String, String>? {
    var s = repoUrl.trim()
    if (s.startsWith("git@")) {
        val at = s.indexOf(':')
        s = if (at >= 0) s.substring(at + 1) else ""
    }
    s = s.removePrefix("https://").removePrefix("http://").removeSuffix(".git").trim('/')
    val parts = s.split('/').filter { it.isNotBlank() }
    if (parts.size < 2) return null
    val owner = parts[parts.size - 2]
    val repo = parts.last()
    if (owner.isBlank() || repo.isBlank()) return null
    return owner to repo
}

class GitRepositoryStore(val baseDir: File) {
    var owner: String? = null
    var repo: String? = null
    val staged: LinkedHashMap<String, String> = LinkedHashMap()
    var lastBranch: String? = null
    var lastMessage: String? = null
}

class GitInitTool(private val store: GitRepositoryStore) : Tool {
    override val name: String = "git_init"
    override val description: String = "Configure a GitHub repository for git operations. Args: repoUrl (required, e.g. https://github.com/owner/repo or owner/repo)"

    override suspend fun invoke(args: Map<String, String>): ToolResult {
        val repoUrl = args["repoUrl"] ?: return ToolResult(output = "", error = "git_init requires repoUrl")
        val parsed = parseRepoUrl(repoUrl) ?: return ToolResult(output = "", error = "invalid repoUrl: $repoUrl (expected owner/repo)")
        store.owner = parsed.first
        store.repo = parsed.second
        store.staged.clear()
        store.lastBranch = null
        store.lastMessage = null
        return ToolResult(output = "configured ${parsed.first}/${parsed.second}")
    }
}

class GitAddTool(
    private val baseDir: File,
    private val store: GitRepositoryStore,
) : Tool {
    override val name: String = "git_add"
    override val description: String = "Stage files for git commit. Args: paths (comma-separated, required)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val pathsStr = args["paths"] ?: return@withContext ToolResult(output = "", error = "git_add requires paths (comma-separated)")
        val paths = pathsStr.split(",").map { it.trim() }.filter { it.isNotBlank() }
        if (paths.isEmpty()) return@withContext ToolResult(output = "", error = "git_add: no valid paths")
        for (rel in paths) {
            val file = File(baseDir, rel).normalize()
            if (!file.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox: $rel")
            if (!file.exists()) return@withContext ToolResult(output = "", error = "file not found: $rel")
            if (file.isDirectory) return@withContext ToolResult(output = "", error = "path is a directory: $rel")
            store.staged[rel] = file.readText()
        }
        ToolResult(output = "staged ${store.staged.size} file(s)")
    }
}

class GitCommitTool(
    private val store: GitRepositoryStore,
    private val clientProvider: suspend () -> GitHubClient,
) : Tool {
    override val name: String = "git_commit"
    override val description: String = "Commit staged files to a new branch. Args: message (required). Requires git_init then git_add first."

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val message = args["message"] ?: return@withContext ToolResult(output = "", error = "git_commit requires message")
        if (store.owner == null || store.repo == null) {
            return@withContext ToolResult(output = "", error = "git_commit: run git_init first")
        }
        if (store.staged.isEmpty()) {
            return@withContext ToolResult(output = "", error = "git_commit: no staged files; run git_add first")
        }
        try {
            val branch = "agent-commit-${System.currentTimeMillis()}"
            val client = clientProvider()
            val headSha = client.getBranchHeadSha("main").getOrThrow()
            client.createBranch(branch, headSha).getOrThrow()
            val files = store.staged.map { CommitFile(it.key, it.value) }
            client.commitFiles(branch, files, message).getOrThrow()
            store.lastBranch = branch
            store.lastMessage = message
            store.staged.clear()
            ToolResult(output = "committed ${files.size} file(s) on branch $branch")
        } catch (e: Exception) {
            ToolResult(output = "", error = "git_commit failed: ${e.message}")
        }
    }
}
