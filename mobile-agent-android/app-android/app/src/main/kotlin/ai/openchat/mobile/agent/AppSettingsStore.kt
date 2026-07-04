package ai.openchat.mobile.agent

import android.content.Context

data class ProviderSettings(
    val baseUrl: String,
    val apiKey: String,
    val model: String,
) {
    val isComplete: Boolean
        get() = baseUrl.isNotBlank() && apiKey.isNotBlank() && model.isNotBlank()
}

data class GitHubSettings(
    val owner: String,
    val repo: String,
    val token: String,
    val baseBranch: String,
) {
    val isComplete: Boolean
        get() = owner.isNotBlank() && repo.isNotBlank() && token.isNotBlank() && baseBranch.isNotBlank()
}

data class AppSettings(
    val provider: ProviderSettings,
    val github: GitHubSettings,
)

class AppSettingsStore(context: Context) {

    private val prefs = context.getSharedPreferences("openchat_agent_settings", Context.MODE_PRIVATE)

    fun load(): AppSettings = AppSettings(
        provider = ProviderSettings(
            baseUrl = prefs.getString(KEY_PROVIDER_BASE_URL, "") ?: "",
            apiKey = prefs.getString(KEY_PROVIDER_API_KEY, "") ?: "",
            model = prefs.getString(KEY_PROVIDER_MODEL, "") ?: "",
        ),
        github = GitHubSettings(
            owner = prefs.getString(KEY_GITHUB_OWNER, "") ?: "",
            repo = prefs.getString(KEY_GITHUB_REPO, "") ?: "",
            token = prefs.getString(KEY_GITHUB_TOKEN, "") ?: "",
            baseBranch = prefs.getString(KEY_GITHUB_BASE_BRANCH, "main") ?: "main",
        )
    )

    fun save(settings: AppSettings) {
        prefs.edit()
            .putString(KEY_PROVIDER_BASE_URL, settings.provider.baseUrl.trim())
            .putString(KEY_PROVIDER_API_KEY, settings.provider.apiKey.trim())
            .putString(KEY_PROVIDER_MODEL, settings.provider.model.trim())
            .putString(KEY_GITHUB_OWNER, settings.github.owner.trim())
            .putString(KEY_GITHUB_REPO, settings.github.repo.trim())
            .putString(KEY_GITHUB_TOKEN, settings.github.token.trim())
            .putString(KEY_GITHUB_BASE_BRANCH, settings.github.baseBranch.trim())
            .apply()
    }

    private companion object {
        const val KEY_PROVIDER_BASE_URL = "provider_base_url"
        const val KEY_PROVIDER_API_KEY = "provider_api_key"
        const val KEY_PROVIDER_MODEL = "provider_model"
        const val KEY_GITHUB_OWNER = "github_owner"
        const val KEY_GITHUB_REPO = "github_repo"
        const val KEY_GITHUB_TOKEN = "github_token"
        const val KEY_GITHUB_BASE_BRANCH = "github_base_branch"
    }
}