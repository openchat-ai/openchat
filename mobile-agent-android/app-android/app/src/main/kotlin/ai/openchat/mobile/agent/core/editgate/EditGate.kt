package ai.openchat.mobile.agent.core.editgate

// === invariants ===
// - original is immutable after construction
// - apply() is idempotent when patch is empty
// - hashOf() must be MD5 hex first 8 chars (HASHLINE)
// - diff() is ordered line diff, not set difference

data class Snapshot(
    val path: String,
    val original: String,
    val hash: String,
)

class EditGate {

    fun snapshot(path: String, content: String): Snapshot =
        Snapshot(path = path, original = content, hash = hashOf(content))

    fun diff(snapshot: Snapshot, proposed: String): String {
        if (snapshot.original == proposed) return ""
        val a = snapshot.original.lines()
        val b = proposed.lines()
        val m = a.size
        val n = b.size
        val dp = Array(m + 1) { IntArray(n + 1) }
        for (i in m - 1 downTo 0) {
            for (j in n - 1 downTo 0) {
                dp[i][j] = if (a[i] == b[j]) {
                    dp[i + 1][j + 1] + 1
                } else {
                    maxOf(dp[i + 1][j], dp[i][j + 1])
                }
            }
        }
        return buildString {
            appendLine("--- ${snapshot.path}")
            appendLine("+++ ${snapshot.path}")
            var i = 0
            var j = 0
            while (i < m && j < n) {
                when {
                    a[i] == b[j] -> {
                        appendLine(" ${a[i]}")
                        i++
                        j++
                    }
                    dp[i + 1][j] >= dp[i][j + 1] -> {
                        appendLine("-${a[i]}")
                        i++
                    }
                    else -> {
                        appendLine("+${b[j]}")
                        j++
                    }
                }
            }
            while (i < m) {
                appendLine("-${a[i]}")
                i++
            }
            while (j < n) {
                appendLine("+${b[j]}")
                j++
            }
        }.trimEnd()
    }

    fun apply(snapshot: Snapshot, proposed: String): Result<String> {
        if (hashOf(snapshot.original) != snapshot.hash) {
            return Result.failure(IllegalStateException("HASH_STALE: ${snapshot.path}"))
        }
        return Result.success(proposed)
    }

    private fun hashOf(content: String): String {
        val digest = java.security.MessageDigest.getInstance("MD5")
        return digest.digest(content.toByteArray()).joinToString("") { "%02x".format(it) }.take(8)
    }
}
