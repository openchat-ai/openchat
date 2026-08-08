package ai.openchat.mobile.agent.core.tools

// === invariants ===
// - Tools are registered by name (unique)
// - get() returns null for unknown tool names
// - getDescription() formats all tools for LLM planning prompt

class ToolRegistry {
    private val tools = mutableMapOf<String, Tool>()

    fun register(tool: Tool) {
        tools[tool.name] = tool
    }

    fun registerAll(tools: List<Tool>) {
        tools.forEach { register(it) }
    }

    fun get(name: String): Tool? = tools[name]

    fun listDescriptions(): String = tools.entries.joinToString("\n") { (name, tool) ->
        "  - ${tool.summary()}"
    }

    fun hasTools(): Boolean = tools.isNotEmpty()
}
