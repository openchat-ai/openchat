package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

// === invariants ===
// - write is write-only: creates/overwrites files; sandbox escape check on path
// - write creates parent directories as needed
// - write overwrites existing files (no append mode)
// - path is required; content defaults to empty string if not provided
// - output reports bytes written after successful write

class WriteTool(private val baseDir: File) : Tool {
    override val name: String = "write"
    override val description: String = "Write content to a file in local storage. Args: path (relative, required), content (optional, default: empty)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val rel = args["path"]
        if (rel.isNullOrBlank()) return@withContext ToolResult(output = "", error = "write requires path")
        val content = args["content"] ?: ""
        val file = File(baseDir, rel).normalize()
        if (!file.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        try {
            file.parentFile?.mkdirs()
            file.writeText(content)
            ToolResult(output = "wrote ${file.length()} bytes to $rel")
        } catch (e: Exception) {
            ToolResult(output = "", error = "write error: ${e.message}")
        }
    }
}

fun createWriteTool(baseDir: File): List<Tool> = listOf(WriteTool(baseDir))
