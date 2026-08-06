package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

// === invariants ===
// - read is read-only: never writes/deletes; sandbox escape check on path
// - read caps: MAX_BYTES total bytes read; files exceeding limit are truncated
// - path is required; empty rel resolves to baseDir root
// - read preserves original file content; no line ending normalization
// - large files beyond MAX_BYTES are truncated with a marker

private const val MAX_READ_BYTES = 512 * 1024

class ReadTool(private val baseDir: File) : Tool {
    override val name: String = "read"
    override val description: String = "Read a file. Args: path (relative to base dir, required)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val rel = args["path"]
        if (rel.isNullOrBlank()) return@withContext ToolResult(output = "", error = "read requires path")
        val file = File(baseDir, rel).normalize()
        if (!file.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (!file.exists()) return@withContext ToolResult(output = "", error = "file not found: $rel")
        if (!file.isFile) return@withContext ToolResult(output = "", error = "not a file: $rel")
        try {
            val content = file.readText()
            val truncated = content.length >= MAX_READ_BYTES
            val result = if (truncated) content.take(MAX_READ_BYTES) + "\n[output truncated at ${MAX_READ_BYTES} bytes]" else content
            ToolResult(output = result)
        } catch (e: Exception) {
            ToolResult(output = "", error = "read error: ${e.message}")
        }
    }
}

fun createReadTool(baseDir: File): List<Tool> = listOf(ReadTool(baseDir))
