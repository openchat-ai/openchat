package ai.openchat.mobile.agent.core.github

import org.json.JSONArray
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

object GitHubDiscovery {

    suspend fun fetchOwners(token: String): Result<List<String>> = runCatching {
        val username = fetchJson(token, "https://api.github.com/user")
            .getString("login")
        val orgs = fetchJsonArray(token, "https://api.github.com/user/orgs")
        val orgNames = buildList {
            add(username)
            for (i in 0 until orgs.length()) {
                orgs.getJSONObject(i).optString("login").takeIf { it.isNotBlank() }?.let { add(it) }
            }
        }
        orgNames
    }

    suspend fun fetchRepos(token: String, owner: String): Result<List<String>> = runCatching {
        val repos = fetchJsonArray(token, "https://api.github.com/users/$owner/repos?per_page=100&sort=updated")
        buildList {
            for (i in 0 until repos.length()) {
                repos.getJSONObject(i).optString("name").takeIf { it.isNotBlank() }?.let { add(it) }
            }
        }.sorted()
    }

    suspend fun fetchBranches(token: String, owner: String, repo: String): Result<List<String>> = runCatching {
        val branches = fetchJsonArray(token, "https://api.github.com/repos/$owner/$repo/branches?per_page=100")
        buildList {
            for (i in 0 until branches.length()) {
                branches.getJSONObject(i).optString("name").takeIf { it.isNotBlank() }?.let { add(it) }
            }
        }
    }

    private fun fetchJson(token: String, url: String): org.json.JSONObject {
        val text = fetchText(token, url)
        return if (text.isBlank()) org.json.JSONObject() else org.json.JSONObject(text)
    }

    private fun fetchJsonArray(token: String, url: String): JSONArray {
        val text = fetchText(token, url)
        return if (text.isBlank()) JSONArray() else JSONArray(text)
    }

    private fun fetchText(token: String, urlStr: String): String {
        val url = URL(urlStr)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10000
            readTimeout = 20000
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            setRequestProperty("User-Agent", "OpenChat-Android-Agent")
        }
        return try {
            val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
            if (stream == null) ""
            else BufferedReader(InputStreamReader(stream)).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }
}
