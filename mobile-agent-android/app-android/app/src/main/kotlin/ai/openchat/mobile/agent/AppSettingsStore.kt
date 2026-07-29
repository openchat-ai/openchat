// New single source: Runtime state is saved in PersistenceManager (plain prefs)
// AppSettingsStore only manages provider/github settings + secrets

// === invariants ===
// - Secrets live only in EncryptedSharedPreferences
// - External backup never writes apiKey/token
// - History data is serialized/deserialized via manual JSON mapping
// - Default baseBranch is always "main" if not specified
// - load() prefers encrypted prefs; external is non-secret fallback only

// === invariants (G2) ===
// - Runtime snapshot is saved in PersistenceManager (single source), not here
// - SettingsStore only handles provider/github settings + secrets

class AppSettingsStore(private val context: Context) {

    private val prefs = createEncryptedPreferences(context)

    init {
        migrateLegacyPreferences(context)
    }

    fun load(): AppSettings {
        val fromPrefs = loadFromPrefs()
        if (fromPrefs.provider.isComplete || fromPrefs.github.isComplete) {
            return fromPrefs
        }
        val fromFile = loadFromExternalFile()
        if (fromFile != null) {
            saveToPrefs(fromFile)
            return fromFile
        }
        return fromPrefs
    }

    fun save(settings: AppSettings) {
        saveToPrefs(settings)
        saveToExternalFile(settings)
    }

    fun saveToPrefs(settings: AppSettings) {
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

    private fun loadFromPrefs(): AppSettings = AppSettings(
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

    @Deprecated("Use PersistenceManager.loadSnapshot() instead", level = DeprecationLevel.WARNING)
    @Suppress("unused")
    fun loadRuntimeSnapshot(): RuntimePersistenceSnapshot? = null

    fun loadTabs(): List<ChatTab> {
        val raw = prefs.getString(KEY_TABS, null) ?: return emptyList()
        return runCatching {
            val json = JSONArray(raw)
            buildList {
                for (i in 0 until json.length()) {
                    json.optJSONObject(i)?.let { add(it.toChatTab()) }
                }
            }
        }.getOrDefault(emptyList())
    }

    fun saveTabs(tabs: List<ChatTab>) {
        val json = JSONArray()
        tabs.forEach { tab -> json.put(tab.toJson()) }
        prefs.edit().putString(KEY_TABS, json.toString()).apply()
    }

    @Deprecated("Use PersistenceManager.save() instead", level = DeprecationLevel.WARNING)
    @Suppress("unused")
    fun saveRuntimeSnapshot(snapshot: RuntimePersistenceSnapshot) {
    }

    private fun saveToExternalFile(settings: AppSettings) {
        val dir = context.getExternalFilesDir(null) ?: return
        val file = java.io.File(dir, EXTERNAL_SETTINGS_FILE)
        // Never write secrets to external storage. Scrub keys on every backup.
        val safe = settings.copy(
            provider = settings.provider.copy(apiKey = ""),
            github = settings.github.copy(token = ""),
        )
        try {
            file.writeText(safe.toJson().toString(2))
        } catch (_: Exception) {
            // Best-effort non-secret backup only; encrypted prefs remain source of truth.
        }
        // Delete legacy backups that may still contain secrets from older builds.
        scrubLegacyExternalSecrets(dir)
    }

    private fun scrubLegacyExternalSecrets(dir: java.io.File) {
        val file = java.io.File(dir, EXTERNAL_SETTINGS_FILE)
        if (!file.exists()) return
        runCatching {
            val json = JSONObject(file.readText())
            val provider = json.optJSONObject("provider")
            val github = json.optJSONObject("github")
            val hadSecret = !provider?.optString("apiKey").isNullOrBlank() ||
                !github?.optString("token").isNullOrBlank()
            if (!hadSecret) return
            provider?.put("apiKey", "")
            github?.put("token", "")
            file.writeText(json.toString(2))
        }
    }

    private fun loadFromExternalFile(): AppSettings? {
        val dir = context.getExternalFilesDir(null) ?: return null
        val file = java.io.File(dir, EXTERNAL_SETTINGS_FILE)
        if (!file.exists()) return null
        return try {
            // External backup is non-secret; force blank secrets even if legacy file still has them.
            val parsed = JSONObject(file.readText()).toAppSettings()
            parsed.copy(
                provider = parsed.provider.copy(apiKey = ""),
                github = parsed.github.copy(token = ""),
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun createEncryptedPreferences(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()

        return EncryptedSharedPreferences.create(
            context,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    private fun migrateLegacyPreferences(context: Context) {
        val legacy = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        if (legacy.all.isEmpty()) return

        val targetKeys = listOf(
            KEY_PROVIDER_BASE_URL,
            KEY_PROVIDER_API_KEY,
            KEY_PROVIDER_MODEL,
            KEY_GITHUB_OWNER,
            KEY_GITHUB_REPO,
            KEY_GITHUB_TOKEN,
            KEY_GITHUB_BASE_BRANCH,
            KEY_ASK_HISTORY,
            KEY_RUNTIME_SNAPSHOT,
        )
        val editor = prefs.edit()
        var migratedAny = false
        targetKeys.forEach { key ->
            if (!prefs.contains(key) && legacy.contains(key)) {
                legacy.all[key]?.let { value ->
                    when (value) {
                        is String -> editor.putString(key, value)
                        is Int -> editor.putInt(key, value)
                        is Long -> editor.putLong(key, value)
                        is Boolean -> editor.putBoolean(key, value)
                        is Float -> editor.putFloat(key, value)
                    }
                    migratedAny = true
                }
            }
        }
        if (migratedAny) {
            editor.apply()
            legacy.edit().clear().apply()
        }
    }

    private companion object {
        const val PREFS_NAME = "openchat_agent_settings"
        const val EXTERNAL_SETTINGS_FILE = "openchat_agent_settings_backup.json"
        const val KEY_PROVIDER_BASE_URL = "provider_base_url"
        const val KEY_PROVIDER_API_KEY = "provider_api_key"
        const val KEY_PROVIDER_MODEL = "provider_model"
        const val KEY_GITHUB_OWNER = "github_owner"
        const val KEY_GITHUB_REPO = "github_repo"
        const val KEY_GITHUB_TOKEN = "github_token"
        const val KEY_GITHUB_BASE_BRANCH = "github_base_branch"
        const val KEY_ASK_HISTORY = "ask_history"
        const val KEY_RUNTIME_SNAPSHOT = "runtime_snapshot"
        const val KEY_TABS = "chat_tabs"
    }
}

private fun AppError.toJson(): JSONObject = JSONObject()
    .put("kind", kind.name)
    .put("code", code)
    .put("message", message)
    .put("retryable", retryable)
    .put("occurredAtMs", occurredAtMs)
    .put("stateSnapshot", stateSnapshot)

private fun JSONObject.toAppError(): AppError = AppError(
    kind = runCatching { ErrorKind.valueOf(optString("kind", ErrorKind.Unknown.name)) }
        .getOrDefault(ErrorKind.Unknown),
    code = optString("code"),
    message = optString("message"),
    retryable = optBoolean("retryable", false),
    occurredAtMs = optLong("occurredAtMs", 0L),
    stateSnapshot = optString("stateSnapshot"),
)

private fun AppSettings.toJson(): JSONObject = JSONObject()
    .put("provider", JSONObject()
        .put("baseUrl", provider.baseUrl)
        .put("apiKey", provider.apiKey)
        .put("model", provider.model))
    .put("github", JSONObject()
        .put("owner", github.owner)
        .put("repo", github.repo)
        .put("token", github.token)
        .put("baseBranch", github.baseBranch))

private fun JSONObject.toAppSettings(): AppSettings = AppSettings(
    provider = optJSONObject("provider")?.let { p ->
        ProviderSettings(
            baseUrl = p.optString("baseUrl", ""),
            apiKey = p.optString("apiKey", ""),
            model = p.optString("model", ""),
        )
    } ?: ProviderSettings("", "", ""),
    github = optJSONObject("github")?.let { g ->
        GitHubSettings(
            owner = g.optString("owner", ""),
            repo = g.optString("repo", ""),
            token = g.optString("token", ""),
            baseBranch = g.optString("baseBranch", "main"),
        )
    } ?: GitHubSettings("", "", "", "main"),
)

private fun JSONObject.optNullableString(key: String): String? {
    if (isNull(key)) return null
    return optString(key).takeIf { it.isNotBlank() && it != "null" }
}

private fun TaskPackage.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("goal", goal)
    .put("createdAtMs", createdAtMs)
    .put("artifactKind", artifactKind.name)
    .put("planSummary", planSummary)
    .put("artifacts", JSONArray().apply { artifacts.forEach { put(it.toJson()) } })
    .put("checkpoints", JSONArray().apply { checkpoints.forEach { put(it.toJson()) } })
    .put("publishIntent", publishIntent.toJson())
    .put("rollbackHints", JSONArray().apply { rollbackHints.forEach(::put) })

private fun Artifact.toJson(): JSONObject = JSONObject()
    .put("path", path)
    .put("mime", mime)
    .put("content", content)
    .put("summary", summary)

private fun Checkpoint.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("label", label)
    .put("reason", reason)
    .put("artifactPaths", JSONArray().apply { artifactPaths.forEach(::put) })

private fun PublishIntent.toJson(): JSONObject = JSONObject()
    .put("baseBranch", baseBranch)
    .put("branchName", branchName)
    .put("commitMessage", commitMessage)
    .put("prTitle", prTitle)
    .put("prBody", prBody)

private fun JSONObject.toTaskPackage(): TaskPackage = TaskPackage(
    id = optString("id"),
    goal = optString("goal"),
    createdAtMs = optLong("createdAtMs", 0L),
    artifactKind = runCatching { ArtifactKind.valueOf(optString("artifactKind", ArtifactKind.MarkdownDraft.name)) }
        .getOrDefault(ArtifactKind.MarkdownDraft),
    planSummary = optString("planSummary"),
    artifacts = optJSONArray("artifacts").toArtifacts(),
    checkpoints = optJSONArray("checkpoints").toCheckpoints(),
    publishIntent = optJSONObject("publishIntent")?.toPublishIntent() ?: PublishIntent(
        baseBranch = "main",
        branchName = "mobile-agent/fallback",
        commitMessage = "docs(agent): fallback draft",
        prTitle = optString("goal"),
        prBody = optString("goal"),
    ),
    rollbackHints = optJSONArray("rollbackHints").toStringList(),
)

private fun JSONArray?.toArtifacts(): List<Artifact> {
    if (this == null) return emptyList()
    return buildList {
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: continue
            add(
                Artifact(
                    path = item.optString("path"),
                    mime = item.optString("mime"),
                    content = item.optString("content"),
                    summary = item.optString("summary"),
                )
            )
        }
    }
}

private fun JSONArray?.toCheckpoints(): List<Checkpoint> {
    if (this == null) return emptyList()
    return buildList {
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: continue
            add(
                Checkpoint(
                    id = item.optString("id"),
                    label = item.optString("label"),
                    reason = item.optString("reason"),
                    artifactPaths = item.optJSONArray("artifactPaths").toStringList(),
                )
            )
        }
    }
}

private fun JSONObject.toPublishIntent(): PublishIntent = PublishIntent(
    baseBranch = optString("baseBranch", "main"),
    branchName = optString("branchName"),
    commitMessage = optString("commitMessage"),
    prTitle = optString("prTitle"),
    prBody = optString("prBody"),
)

private fun JSONArray?.toStringList(): List<String> {
    if (this == null) return emptyList()
    return buildList {
        for (index in 0 until length()) {
            optString(index).takeIf { it.isNotBlank() }?.let(::add)
        }
    }
}