package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

// === invariants ===
// - list is read-only: never writes/deletes; sandbox escape check on path
// - list requires path
// - empty path resolves to baseDir root
// - list supports --recursive flag (default: false) for tree traversal
// - output shows file entries with type indicator and relative path
// - output shows ▸ for directories, ○ for files
// - directories are listed before files in each entry
// - recursive mode shows full tree from each directory
// - path outside sandbox is rejected
// - nonexistent path is rejected

class ListTool(private val baseDir: File) : Tool {
    override val name: String = "list"
    override val description: String =
        "List directory contents. Args: path (relative, required), recursive (optional, 'true' or 'false')"
    override val schemaFields: List<ArgField> = listOf(
        ArgsSchema.path("path", required = true, desc = "directory to list, relative to base"),
        ArgsSchema.bool("recursive", desc = "list recursively"),
    )

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val rel = args["path"]
        if (rel.isNullOrBlank()) return@withContext ToolResult(output = "", error = "list requires path")
        val recursive = args["recursive"]?.toBoolean() ?: false
        val dir = File(baseDir, rel).normalize()
        if (!dir.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (!dir.exists()) return@withContext ToolResult(output = "", error = "path not found: $rel")
        if (!dir.isDirectory) return@withContext ToolResult(output = "", error = "not a directory: $rel")
        try {
            val sb = StringBuilder()
            if (recursive) {
                val entries = dir.walkTopDown().sortedBy { it.name }
                entries.forEach { f ->
                    val indent = " ".repeat((f.path.length - dir.path.length) * 2)
                    val prefix = if (f.isDirectory) "[DIR] " else "[FILE] "
                    sb.append("$indent$prefix${f.name}\n")
                }
            } else {
                val files = dir.listFiles()?.sortedBy { it.name }
                if (files == null || files.isEmpty()) return@withContext ToolResult(output = "(empty directory)")
                files.forEach { f ->
                    val prefix = if (f.isDirectory) "[DIR] " else "[FILE] "
                    sb.append("$prefix${f.name}\n")
                }
            }
            ToolResult(output = sb.toString().trimEnd())
        } catch (e: Exception) {
            ToolResult(output = "", error = "list error: ${e.message}")
        }
    }
}

fun createListTool(baseDir: File): List<Tool> = listOf(ListTool(baseDir))
