package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

// === invariants ===
// - grep_local is read-only: never writes/deletes; sandbox escape check on root AND every file
// - grep_local caps: MAX_LOCAL_MATCHES total, MAX_FILE_BYTES per file (skip larger)
// - grep_repo is read-only: GitHub code search API, default branch only, caps at MAX_REPO_ITEMS
// - both reject blank pattern; grep_repo requires pattern length >= 3 (GitHub API rule)
// - output format grep_local: "relpath:lineNo: line" per match + "(truncated...)" when capped

private const val MAX_LOCAL_MATCHES = 50
private const val MAX_FILE_BYTES = 512L * 1024L
private const val MAX_REPO_ITEMS = 20

class GrepLocalTool(private val baseDir: File) : Tool {
    override val name: String = "grep_local"
    override val description: String = "Search file contents in local storage (case-sensitive substring). Args: pattern (required), path (relative dir, default: root)"
    override val schemaFields: List<ArgField> = listOf(
        ArgsSchema.string("pattern", required = true, desc = "substring to search"),
        ArgsSchema.path("path", desc = "relative directory, default: root"),
    )

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val pattern = args["pattern"]
        if (pattern.isNullOrBlank()) return@withContext ToolResult(output = "", error = "grep_local requires pattern")
        val rel = args["path"] ?: ""
        val root = File(baseDir, rel).normalize()
        if (!root.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "path outside sandbox")
        if (!root.exists()) return@withContext ToolResult(output = "", error = "path not found: $rel")
        try {
            val matches = mutableListOf<String>()
            var truncated = false
            root.walkTopDown().filter { it.isFile }.forEach { file ->
                if (matches.size >= MAX_LOCAL_MATCHES) return@forEach
                if (file.length() > MAX_FILE_BYTES) return@forEach
                val content = try {
                    file.readText()
                } catch (e: Exception) {
                    return@forEach
                }
                content.lineSequence().forEachIndexed { index, line ->
                    if (matches.size >= MAX_LOCAL_MATCHES) {
                        truncated = true
                        return@forEachIndexed
                    }
                    if (line.contains(pattern)) {
                        val fileRel = file.relativeTo(baseDir).path.replace('\\', '/')
                        matches.add("$fileRel:${index + 1}: ${line.take(200)}")
                    }
                }
            }
            if (matches.isEmpty()) return@withContext ToolResult(output = "no matches for: $pattern")
            val suffix = if (truncated) "\n(truncated at $MAX_LOCAL_MATCHES matches)" else ""
            ToolResult(output = matches.joinToString("\n") + suffix)
        } catch (e: Exception) {
            ToolResult(output = "", error = "grep_local error: ${e.message}")
        }
    }
}

class GrepRepoTool(
    private val owner: String,
    private val repo: String,
    private val token: String,
) : Tool {
    override val name: String = "grep_repo"
    override val description: String = "Search file contents in the GitHub repo (default branch). Args: pattern (required, >=3 chars), path (optional dir filter)"
    override val schemaFields: List<ArgField> = listOf(
        ArgsSchema.string("pattern", required = true, desc = "search term, >= 3 chars"),
        ArgsSchema.path("path", desc = "optional directory filter"),
    )

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val pattern = args["pattern"]
        if (pattern.isNullOrBlank()) return@withContext ToolResult(output = "", error = "grep_repo requires pattern")
        if (pattern.trim().length < 3) return@withContext ToolResult(output = "", error = "grep_repo pattern must be >= 3 chars")
        val pathFilter = args["path"]?.takeIf { it.isNotBlank() }
        try {
            val query = buildString {
                append("\"").append(pattern).append("\" repo:").append(owner).append("/").append(repo)
                if (pathFilter != null) append(" path:").append(pathFilter)
            }
            val url = URL("https://api.github.com/search/code?q=" + URLEncoder.encode(query, StandardCharsets.UTF_8.name()))
            val connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10000
                readTimeout = 20000
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Accept", "application/vnd.github.text-match+json")
                setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
                setRequestProperty("User-Agent", "OpenChat-Android-Agent")
            }
            val body = try {
                val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
                if (stream == null) "" else BufferedReader(InputStreamReader(stream)).use { it.readText() }
            } finally {
                connection.disconnect()
            }
            if (connection.responseCode !in 200..299) {
                return@withContext ToolResult(output = "", error = "grep_repo HTTP ${connection.responseCode}: ${body.take(200)}")
            }
            val json = JSONObject(body)
            val items = json.optJSONArray("items") ?: JSONArray()
            if (items.length() == 0) return@withContext ToolResult(output = "no matches for: $pattern")
            val out = buildString {
                appendLine("${json.optInt("total_count", items.length())} file(s) match:")
                val limit = minOf(items.length(), MAX_REPO_ITEMS)
                for (i in 0 until limit) {
                    val item = items.getJSONObject(i)
                    appendLine(item.optString("path", "?"))
                    val textMatches = item.optJSONArray("text_matches")
                    if (textMatches != null && textMatches.length() > 0) {
                        val fragment = textMatches.getJSONObject(0).optString("fragment", "")
                        fragment.lineSequence().take(3).forEach { appendLine("    ${it.take(160)}") }
                    }
                }
            }
            ToolResult(output = out.trimEnd())
        } catch (e: Exception) {
            ToolResult(output = "", error = "grep_repo error: ${e.message}")
        }
    }
}

fun createGrepTools(baseDir: File, owner: String, repo: String, token: String): List<Tool> = listOf(
    GrepLocalTool(baseDir),
    GrepRepoTool(owner, repo, token),
)
