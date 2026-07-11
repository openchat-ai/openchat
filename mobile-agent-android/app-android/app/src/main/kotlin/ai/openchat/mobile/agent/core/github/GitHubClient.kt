package ai.openchat.mobile.agent.core.github

import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.Base64

// === invariants ===
// - token must be non-blank; all ops throw IllegalStateException if blank
// - branch names must not contain spaces
// - commitFiles() is atomic: either all files are committed or none

private const val TAG = "GitHubClient"

data class CommitFile(val path: String, val content: String)

class GitHubClient(
    private val owner: String,
    private val repo: String,
    private val token: String,
) {

    init {
        require(token.isNotBlank()) { "GitHub token must not be blank" }
    }

    suspend fun createBranch(branch: String, fromSha: String): Result<Unit> {
        Log.d(TAG, "[C1] createBranch $branch from $fromSha")
        return runCatching {
            validateBranch(branch)
            val payload = JSONObject()
                .put("ref", "refs/heads/$branch")
                .put("sha", fromSha)
            request("POST", "/git/refs", payload)
            Unit
        }
    }

    suspend fun getBranchHeadSha(branch: String): Result<String> {
        Log.d(TAG, "[C0] getBranchHeadSha $branch")
        return runCatching {
            validateBranch(branch)
            val refJson = request("GET", "/git/ref/heads/${branch.encodePath()}")
            refJson.getJSONObject("object").getString("sha")
        }
    }

    suspend fun fetchFileContent(path: String, branch: String): Result<String> {
        Log.d(TAG, "[C1.1] fetchFileContent $path from $branch")
        return runCatching {
            validateBranch(branch)
            val urlPath = "/contents/${path.encodePath()}?ref=${branch.encodePath()}"
            val response = request("GET", urlPath)
            val contentBase64 = response.getString("content").replace("\n", "")
            String(Base64.getDecoder().decode(contentBase64), StandardCharsets.UTF_8)
        }
    }

    suspend fun commitFiles(
        branch: String,
        files: List<CommitFile>,
        message: String,
    ): Result<String> {
        Log.d(TAG, "[C2] commitFiles count=${files.size} branch=$branch")
        return runCatching {
            validateBranch(branch)
            require(files.isNotEmpty()) { "files must not be empty" }

            val refJson = request("GET", "/git/ref/heads/${branch.encodePath()}")
            val currentCommitSha = refJson.getJSONObject("object").getString("sha")
            val currentCommit = request("GET", "/git/commits/$currentCommitSha")
            val baseTreeSha = currentCommit.getJSONObject("tree").getString("sha")

            val treeEntries = JSONArray()
            files.forEach { file ->
                val blobJson = request(
                    method = "POST",
                    path = "/git/blobs",
                    body = JSONObject()
                        .put("content", Base64.getEncoder().encodeToString(file.content.toByteArray(StandardCharsets.UTF_8)))
                        .put("encoding", "base64")
                )
                treeEntries.put(
                    JSONObject()
                        .put("path", file.path)
                        .put("mode", "100644")
                        .put("type", "blob")
                        .put("sha", blobJson.getString("sha"))
                )
            }

            val treeJson = request(
                method = "POST",
                path = "/git/trees",
                body = JSONObject()
                    .put("base_tree", baseTreeSha)
                    .put("tree", treeEntries)
            )

            val commitJson = request(
                method = "POST",
                path = "/git/commits",
                body = JSONObject()
                    .put("message", message)
                    .put("tree", treeJson.getString("sha"))
                    .put("parents", JSONArray().put(currentCommitSha))
            )

            val newCommitSha = commitJson.getString("sha")
            request(
                method = "PATCH",
                path = "/git/refs/heads/${branch.encodePath()}",
                body = JSONObject().put("sha", newCommitSha).put("force", false)
            )
            newCommitSha
        }
    }

    suspend fun createPullRequest(
        branch: String,
        base: String,
        title: String,
        body: String,
    ): Result<Int> {
        Log.d(TAG, "[C3] createPR $branch -> $base")
        return runCatching {
            validateBranch(branch)
            validateBranch(base)
            val response = request(
                method = "POST",
                path = "/pulls",
                body = JSONObject()
                    .put("title", title)
                    .put("head", branch)
                    .put("base", base)
                    .put("body", body)
            )
            response.getInt("number")
        }
    }

    private fun validateBranch(branch: String) {
        require(branch.isNotBlank()) { "branch must not be blank" }
        require(!branch.contains(' ')) { "branch must not contain spaces" }
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val url = URL("https://api.github.com/repos/$owner/$repo$path")
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15000
            readTimeout = 30000
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            setRequestProperty("User-Agent", "OpenChat-Android-Agent")
        }

        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.bufferedWriter().use { writer ->
                writer.write(body.toString())
            }
        }

        val responseBody = connection.readBody()
        if (connection.responseCode !in 200..299) {
            throw IllegalStateException("GitHub HTTP ${connection.responseCode}: $responseBody")
        }
        return if (responseBody.isBlank()) JSONObject() else JSONObject(responseBody)
    }
}

private fun HttpURLConnection.readBody(): String {
    val stream = if (responseCode in 200..299) inputStream else errorStream
    if (stream == null) return ""
    return BufferedReader(InputStreamReader(stream)).use { reader ->
        reader.readText()
    }
}

private fun String.encodePath(): String =
    URLEncoder.encode(this, StandardCharsets.UTF_8.name()).replace("+", "%20")
