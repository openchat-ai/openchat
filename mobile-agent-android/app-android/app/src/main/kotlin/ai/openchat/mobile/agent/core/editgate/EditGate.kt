package ai.openchat.mobile.agent.core.editgate

// === invariants ===
// - original is immutable after construction
// - apply() is idempotent when patch is empty
// - hashOf() must be consistent with the stored hash

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
        val orig = snapshot.original.lines()
        val next = proposed.lines()
        return buildString {
            appendLine("--- ${snapshot.path}")
            appendLine("+++ ${snapshot.path}")
            val removed = orig.filterNot { it in next }
            val added = next.filterNot { it in orig }
            removed.forEach { appendLine("-$it") }
            added.forEach { appendLine("+$it") }
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
