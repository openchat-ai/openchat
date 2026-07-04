package ai.openchat.mobile.agent.core.tools

interface Tool {
    val name: String
    val description: String
    suspend fun invoke(args: Map<String, String>): ToolResult
}

data class ToolResult(
    val output: String,
    val error: String? = null,
) {
    val isSuccess: Boolean get() = error == null
}
