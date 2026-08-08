package ai.openchat.mobile.agent.core.github

import org.json.JSONArray

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
        val names = mutableSetOf<String>()
        val userUrl = "https://api.github.com/users/$owner/repos?per_page=100&sort=updated&type=all"
        val userRepos = fetchJsonArray(token, userUrl)
        for (i in 0 until userRepos.length()) {
            userRepos.getJSONObject(i).optString("name").takeIf { it.isNotBlank() }?.let { names.add(it) }
        }
        if (names.isEmpty()) {
            val orgUrl = "https://api.github.com/orgs/$owner/repos?per_page=100&sort=updated&type=all"
            val orgRepos = fetchJsonArray(token, orgUrl)
            for (i in 0 until orgRepos.length()) {
                orgRepos.getJSONObject(i).optString("name").takeIf { it.isNotBlank() }?.let { names.add(it) }
            }
        }
        names.sorted()
    }

    suspend fun fetchBranches(token: String, owner: String, repo: String): Result<List<String>> = runCatching {
        val branches = fetchJsonArray(token, "https://api.github.com/repos/$owner/$repo/branches?per_page=100")
        buildList {
            for (i in 0 until branches.length()) {
                branches.getJSONObject(i).optString("name").takeIf { it.isNotBlank() }?.let { add(it) }
            }
        }
    }

    suspend fun fetchTree(token: String, owner: String, repo: String, sha: String, recursive: Boolean = false): Result<List<String>> = runCatching {
        val url = "https://api.github.com/repos/$owner/$repo/git/trees/$sha${if (recursive) "?recursive=1" else ""}"
        val tree = fetchJson(token, url).optJSONArray("tree") ?: JSONArray()
        buildList {
            for (i in 0 until tree.length()) {
                val item = tree.getJSONObject(i)
                if (item.optString("type") == "blob") {
                    item.optString("path").takeIf { it.isNotBlank() }?.let { add(it) }
                }
            }
        }
    }

private suspend fun fetchJson(token: String, url: String): org.json.JSONObject {
    val text = GithubHttp.fetchWithRetry(token, url, "application/vnd.github+json")
    return if (text.isBlank()) org.json.JSONObject() else org.json.JSONObject(text)
}

private suspend fun fetchJsonArray(token: String, url: String): JSONArray {
    val text = GithubHttp.fetchWithRetry(token, url, "application/vnd.github+json")
    return if (text.isBlank()) JSONArray() else JSONArray(text)
}
}
