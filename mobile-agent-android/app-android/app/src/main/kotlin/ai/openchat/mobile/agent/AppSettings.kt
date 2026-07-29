package ai.openchat.mobile.agent

data class AskTurn(
    val role: String,
    val content: String,
)

data class ProviderSettings(
    val baseUrl: String,
    val apiKey: String,
    val model: String,
) {
    val isComplete: Boolean get() = baseUrl.isNotBlank() && apiKey.isNotBlank() && model.isNotBlank()
}

data class GitHubSettings(
    val owner: String,
    val repo: String,
    val token: String,
    val baseBranch: String,
) {
    val isComplete: Boolean get() = owner.isNotBlank() && repo.isNotBlank() && token.isNotBlank()
}

data class AppSettings(
    val provider: ProviderSettings,
    val github: GitHubSettings,
)
