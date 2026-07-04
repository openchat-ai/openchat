package ai.openchat.mobile.agent

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class AskTurn(
    val role: String,
    val content: String,
)

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

    fun loadAskHistory(): List<AskTurn> {
        val raw = prefs.getString(KEY_ASK_HISTORY, null) ?: return emptyList()
        return runCatching {
            val json = JSONArray(raw)
            buildList {
                for (index in 0 until json.length()) {
                    val item = json.optJSONObject(index) ?: continue
                    val role = item.optString("role")
                    val content = item.optString("content")
                    if (role.isNotBlank() && content.isNotBlank()) {
                        add(AskTurn(role = role, content = content))
                    }
                }
            }
        }.getOrDefault(emptyList())
    }

    fun saveAskHistory(history: List<AskTurn>) {
        val json = JSONArray()
        history.forEach { turn ->
            json.put(
                JSONObject()
                    .put("role", turn.role)
                    .put("content", turn.content)
            )
        }
        prefs.edit().putString(KEY_ASK_HISTORY, json.toString()).apply()
    }

    private companion object {
        const val KEY_PROVIDER_BASE_URL = "provider_base_url"
        const val KEY_PROVIDER_API_KEY = "provider_api_key"
        const val KEY_PROVIDER_MODEL = "provider_model"
        const val KEY_GITHUB_OWNER = "github_owner"
        const val KEY_GITHUB_REPO = "github_repo"
        const val KEY_GITHUB_TOKEN = "github_token"
        const val KEY_GITHUB_BASE_BRANCH = "github_base_branch"
        const val KEY_ASK_HISTORY = "ask_history"
    }
}