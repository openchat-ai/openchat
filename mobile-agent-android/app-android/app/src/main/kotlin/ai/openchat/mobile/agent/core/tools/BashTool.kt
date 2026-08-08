package ai.openchat.mobile.agent.core.tools

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

// === invariants ===
// - bash runs on Dispatchers.IO (process execution)
// - command is required; workdir defaults to baseDir; timeout defaults to 30s, max 5min
// - output is capped at MAX_OUTPUT_BYTES; truncated output is marked
// - bash is sandboxed: workdir must be within baseDir (sandbox escape check)
// - bash is read-only by convention: it does not write to baseDir unless the command does
// - command string is passed to /bin/sh -c on POSIX, cmd.exe /c on Windows

private const val MAX_OUTPUT_BYTES = 1024 * 1024
private const val DEFAULT_TIMEOUT_SECONDS = 30L
private const val MAX_TIMEOUT_SECONDS = 300L

class BashTool(private val baseDir: File) : Tool {
    override val name: String = "bash"
    override val description: String = "Execute a shell command on the device"
    override val schemaFields: List<ArgField> = listOf(
        ArgsSchema.string("command", required = true, desc = "shell command to execute"),
        ArgsSchema.string("workdir", desc = "relative directory, default: base dir"),
        ArgsSchema.long("timeout", default = DEFAULT_TIMEOUT_SECONDS, desc = "seconds, default 30, max 300"),
    )

    override suspend fun invoke(args: Map<String, String>): ToolResult = withContext(Dispatchers.IO) {
        val a = Args(args)
        val command = a.string("command")
        if (command == null) return@withContext ToolResult(output = "", error = "bash requires command")
        val workdir = a.string("workdir", "")
        val timeoutSec = a.long("timeout", DEFAULT_TIMEOUT_SECONDS)
        if (timeoutSec > MAX_TIMEOUT_SECONDS) return@withContext ToolResult(output = "", error = "bash timeout exceeds maximum of ${MAX_TIMEOUT_SECONDS}s")
        if (timeoutSec < 1) return@withContext ToolResult(output = "", error = "bash timeout must be >= 1s")
        val root = File(baseDir, workdir).normalize()
        if (!root.startsWith(baseDir)) return@withContext ToolResult(output = "", error = "workdir outside sandbox")
        if (!root.exists() || !root.isDirectory) return@withContext ToolResult(output = "", error = "workdir not found: $workdir")
        val shell = if (System.getProperty("os.name").lowercase().contains("win")) "cmd.exe" else "/bin/sh"
        val shellArgs = if (System.getProperty("os.name").lowercase().contains("win")) listOf("/c", command) else listOf("-c", command)
        try {
            val process = ProcessBuilder(shell, *shellArgs.toTypedArray())
                .directory(root)
                .redirectErrorStream(true)
                .start()
            val completed = process.waitFor(timeoutSec, TimeUnit.SECONDS)
            if (!completed) {
                process.destroyForcibly()
                return@withContext ToolResult(output = "", error = "bash timed out after ${timeoutSec}s (command: ${command.take(100)})")
            }
            val output = process.inputStream.bufferedReader().use { it.readText() }
            val truncated = output.length >= MAX_OUTPUT_BYTES
            val result = if (truncated) output.take(MAX_OUTPUT_BYTES) + "\n[output truncated at ${MAX_OUTPUT_BYTES} bytes]" else output
            val exitCode = process.exitValue()
            ToolResult(output = result.ifBlank { "(exit code $exitCode, no output)" }, error = if (exitCode != 0) "bash exited with code $exitCode" else null)
        } catch (e: Exception) {
            ToolResult(output = "", error = "bash error: ${e.message}")
        }
    }
}

fun createBashTool(baseDir: File): List<Tool> = listOf(BashTool(baseDir))