package ai.openchat.mobile.agent.core.tools

interface Tool {
    val name: String
    val description: String
    val schemaFields: List<ArgField> get() = emptyList()
    suspend fun invoke(args: Map<String, String>): ToolResult

    fun summary(): String = buildString {
        append("$name: $description")
        val fields = schemaFields
        if (fields.isNotEmpty()) {
            append(" [args: ${fields.map { it.schemaFragment() }.joinToString(", ")}]")
        }
    }
}

data class ToolResult(
    val output: String,
    val error: String? = null,
) {
    val isSuccess: Boolean get() = error == null
}
