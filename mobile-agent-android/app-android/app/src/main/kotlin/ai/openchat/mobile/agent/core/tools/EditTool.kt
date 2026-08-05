package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

// === invariants ===
// - edit is sandboxed: path must resolve under baseDir
// - edit uses exact string matching (old_string must match exactly once)
// - edit never creates new files; only modifies existing
// - edit preserves original line endings

class EditTool(private val baseDir: File) : Tool {
    override val name: String = "edit"
    override val description: String = "Edit a file by replacing old_string with new_string. Args: path (relative, required), old_string (required), new_string (required)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val rel = args["path"]
        val oldString = args["old_string"]
        val newString = args["new_string"]

        if (rel.isNullOrBlank()) return@withContext ToolResult(output = "", error = "edit requires path")
        if (oldString.isNullOrEmpty()) return@withContext ToolResult(output = "", error = "edit requires old_string")
        if (newString == null) return@withContext ToolResult(output = "", error = "edit requires new_string")

        val file = File(baseDir, rel).normalize()
        if (!file.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (!file.exists()) return@withContext ToolResult(output = "", error = "file not found: $rel")

        try {
            val content = file.readText()
            val occurrences = content.split(oldString).size - 1
            if (occurrences == 0) {
                return@withContext ToolResult(output = "", error = "old_string not found in $rel")
            }
            if (occurrences > 1) {
                return@withContext ToolResult(output = "", error = "old_string found $occurrences times in $rel; must be unique")
            }
            val updated = content.replace(oldString, newString!!)
            file.writeText(updated)
            return@withContext ToolResult(output = "edited $rel (replaced 1 occurrence, ${updated.length} bytes total)")
        } catch (e: Exception) {
            ToolResult(output = "", error = "edit error: ${e.message}")
        }
    }
}

fun createEditTool(baseDir: File): List<Tool> = listOf(EditTool(baseDir))
