package ai.openchat.mobile.agent.core.agent

import java.io.File

/**
 * Scans a workspace root directory and returns a concise markdown summary
 * of the repository structure for agent planning context.
 *
 * Scan scope:
 *   - Top-level directory listing (dirs + files)
 *   - README (any variant: README.md, README.txt, etc.)
 *   - Key config files (package.json, build.gradle, pom.xml, etc.)
 *
 * Design constraints:
 *   - Non-recursive (top-level only) — agent uses tools for deep traversal
 *   - Bounded output — capped at reasonable length for LLM context window
 *   - IO-safe — errors silently fall back to empty sections
 */
class WorkspaceScanner(private val workspaceRoot: File) {

    private companion object {
        private const val MAX_README_CHARS = 3000
        private const val MAX_CONFIG_CHARS = 800
        private const val MAX_TOTAL_CHARS = 4000
        private val KEY_CONFIG_FILES = setOf(
            "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
            "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
            "gradle.properties", "gradlew", "gradlew.bat",
            "pom.xml", "mvnw",
            "Cargo.toml", "Cargo.lock",
            "pubspec.yaml", "pubspec.lock",
            "go.mod", "go.sum",
            "requirements.txt", "Pipfile", "Pipfile.lock",
            "pyproject.toml", "setup.py", "setup.cfg",
            "Gemfile", "Gemfile.lock",
            "Makefile", "Dockerfile", "docker-compose.yml",
            "AGENTS.md", "README.md", "README.txt", "README.rst",
            ".gitignore", ".dockerignore",
        )
    }

    fun scan(): String = buildString {
        val root = workspaceRoot
        if (!root.exists() || !root.isDirectory) {
            append("Workspace root does not exist: ${root.absolutePath}")
            return@buildString
        }

        append("## Workspace: ${root.absolutePath}\n\n")

        val children = runCatching { root.listFiles() ?: emptyArray() }.getOrDefault(emptyArray())

        append("**Top-level directories:** ")
        val dirs = children.filter { it.isDirectory }.map { it.name }
        append(if (dirs.isEmpty()) "(none)" else dirs.joinToString(", "))
        append("\n\n")

        append("**Top-level files:** ")
        val files = children.filter { it.isFile }.map { it.name }
        append(if (files.isEmpty()) "(none)" else files.joinToString(", "))
        append("\n\n")

        append(readmeSection())

        val configs = keyConfigFiles(children)
        if (configs.isNotEmpty()) {
            append("## Key Config Files\n\n")
            configs.forEach { file ->
                append("### ${file.name}\n")
                append("```\n")
                append(runCatching {
                    val text = file.readText().trim()
                    if (text.length > MAX_CONFIG_CHARS) text.take(MAX_CONFIG_CHARS) + "..."
                    else text
                }.getOrDefault("(unreadable)"))
                append("\n```\n\n")
            }
        }
    }.take(MAX_TOTAL_CHARS)

    private fun readmeSection(): String = buildString {
        val children = runCatching { workspaceRoot.listFiles() ?: emptyArray() }.getOrDefault(emptyArray())
        val readme = children.find { it.isFile && it.name.lowercase().startsWith("readme") }
        if (readme == null) {
            append("## README\n\n(No README found at workspace root)\n\n")
            return@buildString
        }

        append("## ${readme.name}\n\n")
        append(runCatching {
            val text = readme.readText().trim()
            if (text.length > MAX_README_CHARS) text.take(MAX_README_CHARS) + "..."
            else text
        }.getOrDefault("(unreadable)"))
        append("\n\n")
    }

    private fun keyConfigFiles(children: Array<File>): List<File> =
        children.filter { it.isFile && KEY_CONFIG_FILES.contains(it.name) }
}
