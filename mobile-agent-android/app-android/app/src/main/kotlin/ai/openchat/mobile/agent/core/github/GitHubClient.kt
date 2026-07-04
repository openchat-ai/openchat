package ai.openchat.mobile.agent.core.github

import android.util.Log

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
        return runCatching { /* TODO: call GitHub REST API */ }
    }

    suspend fun commitFiles(
        branch: String,
        files: List<CommitFile>,
        message: String,
    ): Result<String> {
        Log.d(TAG, "[C2] commitFiles count=${files.size} branch=$branch")
        return runCatching {
            // TODO: get tree SHA, create blobs, create tree, create commit, update ref
            "stub-sha"
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
            // TODO: call POST /repos/{owner}/{repo}/pulls
            0
        }
    }
}
