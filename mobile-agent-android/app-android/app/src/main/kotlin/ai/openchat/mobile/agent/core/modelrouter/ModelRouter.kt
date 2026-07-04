package ai.openchat.mobile.agent.core.modelrouter

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

// === invariants ===
// - providers list must be non-empty; constructor throws if empty
// - fallback iterates in order; first success wins
// - ModelResponse.error is non-null only on total failure

data class ModelRequest(val prompt: String, val maxTokens: Int = 512)
data class ModelResponse(val text: String? = null, val error: String? = null) {
    val isSuccess: Boolean get() = text != null && error == null
}

interface ModelProvider {
    val id: String
    suspend fun ask(request: ModelRequest): ModelResponse
}

data class OpenAiCompatibleConfig(
    val baseUrl: String,
    val apiKey: String,
    val model: String,
)

class OpenAiCompatibleProvider(
    override val id: String,
    private val config: OpenAiCompatibleConfig,
) : ModelProvider {

    override suspend fun ask(request: ModelRequest): ModelResponse = runCatching {
        val connection = openConnection(config.baseUrl)
        val payload = JSONObject()
            .put("model", config.model)
            .put("max_tokens", request.maxTokens)
            .put("messages", JSONArray().put(JSONObject()
                .put("role", "user")
                .put("content", request.prompt)))

        connection.outputStream.bufferedWriter().use { writer ->
            writer.write(payload.toString())
        }

        val responseBody = connection.readBody()
        if (connection.responseCode !in 200..299) {
            return ModelResponse(error = "${config.model}: HTTP ${connection.responseCode} $responseBody")
        }

        val json = JSONObject(responseBody)
        val choices = json.optJSONArray("choices") ?: JSONArray()
        val first = choices.optJSONObject(0)
        val text = first?.optJSONObject("message")?.optString("content")
            ?: first?.optString("text")
            ?: ""

        if (text.isBlank()) {
            ModelResponse(error = "${config.model}: empty response")
        } else {
            ModelResponse(text = text.trim())
        }
    }.getOrElse { error ->
        ModelResponse(error = "${config.model}: ${error.message}")
    }

    private fun openConnection(baseUrl: String): HttpURLConnection {
        val normalized = baseUrl.trimEnd('/')
        val url = URL("$normalized/chat/completions")
        return (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 30000
            doOutput = true
            setRequestProperty("Authorization", "Bearer ${config.apiKey}")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", "application/json")
        }
    }
}

class ModelRouter(private val providers: List<ModelProvider>) {

    init {
        require(providers.isNotEmpty()) { "ModelRouter requires at least one provider" }
    }

    suspend fun ask(request: ModelRequest): ModelResponse {
        val failures = mutableListOf<String>()
        for (provider in providers) {
            val response = provider.ask(request)
            if (response.isSuccess) return response
            response.error?.let { failures += "${provider.id}: $it" }
        }
        return ModelResponse(error = failures.joinToString(separator = " | ").ifBlank { "all providers failed" })
    }
}

private fun HttpURLConnection.readBody(): String {
    val stream = if (responseCode in 200..299) inputStream else errorStream
    if (stream == null) return ""
    return BufferedReader(InputStreamReader(stream)).use { reader ->
        reader.readText()
    }
}
