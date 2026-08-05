package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.regex.Pattern

// === invariants ===
// - glob is read-only: never writes/deletes; sandbox escape check on path
// - glob caps: MAX_RESULTS total results returned
// - pattern is required; path defaults to baseDir root; limit defaults to MAX_RESULTS
// - glob patterns: "*" matches single dir, "**" matches any depth, "*" matches any filename chars
// - output format: one relative path per line, "No files found" if empty, "(truncated...)" when capped

private const val MAX_RESULTS = 100

class GlobTool(private val baseDir: File) : Tool {
    override val name: String = "glob"
    override val description: String = "Find files by glob pattern within base directory. Args: pattern (required), path (relative dir, default: root), limit (max results, default: 100)"

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val pattern = args["pattern"]
        if (pattern.isNullOrBlank()) return@withContext ToolResult(output = "", error = "glob requires pattern")
        val limit = minOf(args["limit"]?.toIntOrNull() ?: MAX_RESULTS, MAX_RESULTS)
        if (limit < 1) return@withContext ToolResult(output = "", error = "glob limit must be >= 1")
        val rel = args["path"]?.takeIf { it.isNotBlank() } ?: ""
        val root = File(baseDir, rel).normalize()
        if (!root.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (!root.exists()) return@withContext ToolResult(output = "", error = "path not found: $rel")
        try {
            val regex = globToRegex(pattern)
            val matches = mutableListOf<String>()
            var truncated = false
            root.walkTopDown().filter { it.isFile }.forEach { file ->
                if (matches.size >= limit) {
                    truncated = true
                    return@forEach
                }
                val fileRel = file.relativeTo(baseDir).path.replace('\\', '/')
                if (regex.matcher(fileRel).matches()) {
                    matches.add(fileRel)
                }
            }
            if (matches.isEmpty()) return@withContext ToolResult(output = "No files found")
            val suffix = if (truncated) "\n(truncated at $limit results)" else ""
            ToolResult(output = matches.sorted().joinToString("\n") + suffix)
        } catch (e: Exception) {
            ToolResult(output = "", error = "glob error: ${e.message}")
        }
    }

    private fun globToRegex(glob: String): Pattern {
        val sb = StringBuilder("^")
        var i = 0
        while (i < glob.length) {
            when (glob[i]) {
                '*' -> {
                    if (i + 1 < glob.length && glob[i + 1] == '*') {
                        sb.append(".*")
                        i += 2
                        if (i < glob.length && glob[i] == '/') {
                            sb.append(".*/")
                            i++
                        }
                    } else {
                        sb.append("[^/]*")
                        i++
                    }
                }
                '?' -> { sb.append("[^/]"); i++ }
                '.', '(', ')', '+', '|', '^', '$', '@', '!' -> {
                    sb.append(Pattern.quote(glob[i].toString())); i++
                }
                else -> { sb.append(glob[i]); i++ }
            }
        }
        sb.append("$")
        return Pattern.compile(sb.toString())
    }
}

fun createGlobTool(baseDir: File): List<Tool> = listOf(GlobTool(baseDir))