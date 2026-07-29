package ai.openchat.mobile.agent.core.editgate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EditGateTest {

    private val gate = EditGate()

    @Test
    fun sameContent_emptyDiff() {
        val snap = gate.snapshot("a.kt", "one\ntwo\n")
        assertEquals("", gate.diff(snap, "one\ntwo\n"))
    }

    @Test
    fun reorderLines_isOrderedDiffNotSetDiff() {
        val snap = gate.snapshot("a.kt", "a\nb\nc\n")
        val diff = gate.diff(snap, "a\nc\nb\n")
        assertTrue(diff.contains("-b") || diff.contains("-c"))
        assertTrue(diff.contains("+b") || diff.contains("+c"))
        // set-diff would wrongly claim no change when lines are a permutation
        assertTrue(diff.lines().any { it.startsWith("-") || it.startsWith("+") })
    }

    @Test
    fun hashIsMd5First8() {
        val content = "hello"
        val snap = gate.snapshot("x", content)
        val digest = java.security.MessageDigest.getInstance("MD5")
        val expected = digest.digest(content.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(8)
        assertEquals(expected, snap.hash)
        assertEquals(8, snap.hash.length)
    }

    @Test
    fun apply_hashStale_fails() {
        val snap = Snapshot(path = "a.kt", original = "ok", hash = "deadbeef")
        val result = gate.apply(snap, "ok")
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.startsWith("HASH_STALE") == true)
    }

    @Test
    fun apply_matchingHash_returnsProposed() {
        val snap = gate.snapshot("a.kt", "base\n")
        val result = gate.apply(snap, "base\nchanged\n")
        assertEquals("base\nchanged\n", result.getOrThrow())
    }
}
