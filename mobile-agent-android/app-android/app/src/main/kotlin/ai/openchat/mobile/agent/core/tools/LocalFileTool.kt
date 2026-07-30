package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

class ReadLocalFileTool(private val baseDir: File) : Tool {
    override val name: String = "read_local_file"
    override val description: String = "Read a file from local storage. Args: path (relative to app sandbox, required)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val rel = args["path"] ?: return@withContext ToolResult(output = "", error = "read_local_file requires path")
        val file = File(baseDir, rel).normalize()
        if (!file.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (!file.exists()) return@withContext ToolResult(output = "", error = "file not found: $rel")
        try {
            ToolResult(output = file.readText())
        } catch (e: Exception) {
            ToolResult(output = "", error = "read_local_file error: ${e.message}")
        }
    }
}

class WriteLocalFileTool(private val baseDir: File) : Tool {
    override val name: String = "write_local_file"
    override val description: String = "Write content to a file in local storage. Args: path (relative, required), content (required)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val rel = args["path"] ?: return@withContext ToolResult(output = "", error = "write_local_file requires path")
        val content = args["content"] ?: return@withContext ToolResult(output = "", error = "write_local_file requires content")
        val file = File(baseDir, rel).normalize()
        if (!file.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        try {
            file.parentFile?.mkdirs()
            file.writeText(content)
            ToolResult(output = "wrote ${file.length()} bytes to $rel")
        } catch (e: Exception) {
            ToolResult(output = "", error = "write_local_file error: ${e.message}")
        }
    }
}

class ListLocalDirTool(private val baseDir: File) : Tool {
    override val name: String = "list_local_dir"
    override val description: String = "List files in a local directory. Args: path (relative, default: root)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val rel = args["path"] ?: ""
        val dir = File(baseDir, rel).normalize()
        if (!dir.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (!dir.isDirectory) return@withContext ToolResult(output = "", error = "not a directory: $rel")
        try {
            val listing = dir.listFiles()?.map { f ->
                val type = if (f.isDirectory) "dir" else "file"
                "$type  ${f.name}  (${f.length()} B)"
            }?.joinToString("\n") ?: ""
            ToolResult(output = "Contents of $rel:\n$listing")
        } catch (e: Exception) {
            ToolResult(output = "", error = "list_local_dir error: ${e.message}")
        }
    }
}

class DeleteLocalFileTool(private val baseDir: File) : Tool {
    override val name: String = "delete_local_file"
    override val description: String = "Delete a file from local storage. Args: path (relative, required)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val rel = args["path"] ?: return@withContext ToolResult(output = "", error = "delete_local_file requires path")
        val file = File(baseDir, rel).normalize()
        if (!file.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (!file.exists()) return@withContext ToolResult(output = "", error = "file not found: $rel")
        try {
            val ok = file.delete()
            if (ok) ToolResult(output = "deleted $rel") else ToolResult(output = "", error = "delete failed: $rel")
        } catch (e: Exception) {
            ToolResult(output = "", error = "delete_local_file error: ${e.message}")
        }
    }
}

fun createLocalFileTools(baseDir: File): List<Tool> = listOf(
    ReadLocalFileTool(baseDir),
    WriteLocalFileTool(baseDir),
    ListLocalDirTool(baseDir),
    DeleteLocalFileTool(baseDir),
)
