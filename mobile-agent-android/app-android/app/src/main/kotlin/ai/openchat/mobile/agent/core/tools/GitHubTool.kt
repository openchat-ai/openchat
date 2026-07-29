package ai.openchat.mobile.agent.core.tools

import ai.openchat.mobile.agent.Artifact
import ai.openchat.mobile.agent.core.editgate.EditGate
import ai.openchat.mobile.agent.core.github.GitHubClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// === invariants ===
// - All tools run on Dispatchers.IO (network)
// - list_tree needs path, owner, repo, token
// - read_file needs path, branch, owner, repo, token
// - hash_edit needs path, content, owner, repo, token; creates Artifact via EditGate
// - hash_edit is mutating: must be wrapped in a checkpoint for approval

class ListTreeTool(private val clientProvider: suspend () -> GitHubClient) : Tool {
    override val name: String = "list_tree"
    override val description: String = "List files in a directory tree. Args: path (default: root)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val path = args["path"] ?: ""
        try {
            val client = clientProvider()
            val result = client.fetchTree(path)
            result.fold(
                onSuccess = { ToolResult(output = it) },
                onFailure = { ToolResult(output = "", error = "list_tree failed: ${it.message}") }
            )
        } catch (e: Exception) {
            ToolResult(output = "", error = "list_tree error: ${e.message}")
        }
    }
}

class ReadFileTool(private val clientProvider: suspend () -> GitHubClient) : Tool {
    override val name: String = "read_file"
    override val description: String = "Read a file from the repo. Args: path (required), branch (default: main)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val path = args["path"] ?: return@withContext ToolResult(output = "", error = "read_file requires path")
        val branch = args["branch"] ?: "main"
        try {
            val client = clientProvider()
            val result = client.fetchFileContent(path, branch)
            result.fold(
                onSuccess = { ToolResult(output = it) },
                onFailure = { ToolResult(output = "", error = "read_file failed: ${it.message}") }
            )
        } catch (e: Exception) {
            ToolResult(output = "", error = "read_file error: ${e.message}")
        }
    }
}

class HashEditTool(
    private val clientProvider: suspend () -> GitHubClient,
    private val editGate: EditGate = EditGate(),
) : Tool {
    override val name: String = "hash_edit"
    override val description: String = "Edit a file via EditGate (snapshot→diff→apply→artifact). Args: path (required), newContent (required), branch (default: main)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val path = args["path"] ?: return@withContext ToolResult(output = "", error = "hash_edit requires path")
        val newContent = args["newContent"] ?: return@withContext ToolResult(output = "", error = "hash_edit requires newContent")
        val branch = args["branch"] ?: "main"
        try {
            val client = clientProvider()
            val originalResult = client.fetchFileContent(path, branch)
            val original = originalResult.getOrNull() ?: ""
            val snapshot = editGate.snapshot(path, original)
            val applied = editGate.apply(snapshot, newContent).getOrElse { error ->
                return@withContext ToolResult(output = "", error = "hash_edit gate rejected: ${error.message}")
            }
            val artifact = Artifact(
                path = path,
                mime = "text/plain",
                content = applied,
                summary = "EditGate: $path",
            )
            ToolResult(output = artifact.toToolResult())
        } catch (e: Exception) {
            ToolResult(output = "", error = "hash_edit error: ${e.message}")
        }
    }
}

internal fun Artifact.toToolResult(): String =
    "path=$path|mime=$mime|content=$content|summary=$summary"

fun createGitHubTools(clientProvider: suspend () -> GitHubClient): List<Tool> = listOf(
    ListTreeTool(clientProvider),
    ReadFileTool(clientProvider),
    HashEditTool(clientProvider),
)


