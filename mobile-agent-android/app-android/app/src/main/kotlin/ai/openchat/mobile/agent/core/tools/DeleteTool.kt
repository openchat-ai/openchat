package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

// === invariants ===
// - delete removes a single file; sandbox escape check on path
// - delete refuses to remove the sandbox root itself
// - delete refuses non-empty directories (must list + delete children first)
// - path is required; nonexistent path is rejected
// - output reports the deleted path on success

class DeleteTool(private val baseDir: File) : Tool {
    override val name: String = "delete"
    override val description: String = "Delete a file in local storage"
    override val schemaFields: List<ArgField> = listOf(
        ArgsSchema.path("path", required = true, desc = "file or empty dir to delete relative to base dir"),
    )

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val a = Args(args)
        val rel = a.string("path")
        if (rel == null) return@withContext ToolResult(output = "", error = "delete requires path")
        val file = File(baseDir, rel).normalize()
        if (!file.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (file == baseDir) return@withContext ToolResult(output = "", error = "refusing to delete sandbox root")
        if (!file.exists()) return@withContext ToolResult(output = "", error = "path not found: $rel")
        try {
            if (file.isDirectory && file.listFiles()?.isNotEmpty() == true) {
                return@withContext ToolResult(output = "", error = "not deleting non-empty directory: $rel")
            }
            if (file.isDirectory) {
                file.delete()
            } else {
                file.delete()
            }
            if (file.exists()) {
                ToolResult(output = "", error = "delete failed: $rel")
            } else {
                ToolResult(output = "deleted $rel")
            }
        } catch (e: Exception) {
            ToolResult(output = "", error = "delete error: ${e.message}")
        }
    }
}

fun createDeleteTool(baseDir: File): List<Tool> = listOf(DeleteTool(baseDir))
