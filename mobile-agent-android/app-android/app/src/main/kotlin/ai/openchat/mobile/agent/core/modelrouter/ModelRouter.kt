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

data class ModelMessage(
    val role: String,
    val content: String,
)

data class ModelRequest(
    val prompt: String,
    val maxTokens: Int = 512,
    val messages: List<ModelMessage> = emptyList(),
) {
    fun resolvedMessages(): List<ModelMessage> =
        if (messages.isNotEmpty()) messages else listOf(ModelMessage(role = "user", content = prompt))
}

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
        val connection = openConnection(baseUrl = config.baseUrl, stream = false)
        connection.writeRequestBody(request, stream = false)

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

    suspend fun streamAsk(
        request: ModelRequest,
        onDelta: suspend (String) -> Unit,
    ): ModelResponse = runCatching {
        val connection = openConnection(baseUrl = config.baseUrl, stream = true)
        connection.writeRequestBody(request, stream = true)

        if (connection.responseCode !in 200..299) {
            val errorBody = connection.readBody()
            return ModelResponse(error = "${config.model}: HTTP ${connection.responseCode} $errorBody")
        }

        val stream = connection.inputStream ?: return ModelResponse(error = "${config.model}: empty stream")
        val fullText = StringBuilder()
        BufferedReader(InputStreamReader(stream)).useLines { lines ->
            lines.forEach { line ->
                if (!line.startsWith("data:")) return@forEach
                val payload = line.removePrefix("data:").trim()
                if (payload.isEmpty() || payload == "[DONE]") return@forEach
                val json = runCatching { JSONObject(payload) }.getOrNull() ?: return@forEach
                val delta = json.optJSONArray("choices")
                    ?.optJSONObject(0)
                    ?.optJSONObject("delta")
                    ?.optString("content")
                    .orEmpty()
                if (delta.isNotEmpty()) {
                    fullText.append(delta)
                    onDelta(delta)
                }
            }
        }

        val text = fullText.toString().trim()
        if (text.isBlank()) {
            ModelResponse(error = "${config.model}: empty streamed response")
        } else {
            ModelResponse(text = text)
        }
    }.getOrElse { error ->
        ModelResponse(error = "${config.model}: ${error.message}")
    }

    private fun openConnection(baseUrl: String, stream: Boolean): HttpURLConnection {
        val normalized = baseUrl.trimEnd('/')
        val url = URL("$normalized/chat/completions")
        return (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 15000
            readTimeout = 30000
            doOutput = true
            setRequestProperty("Authorization", "Bearer ${config.apiKey}")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Accept", if (stream) "text/event-stream" else "application/json")
        }
    }

    private fun HttpURLConnection.writeRequestBody(request: ModelRequest, stream: Boolean) {
        val messagesJson = JSONArray()
        request.resolvedMessages().forEach { message ->
            messagesJson.put(
                JSONObject()
                    .put("role", message.role)
                    .put("content", message.content)
            )
        }
        val payload = JSONObject()
            .put("model", config.model)
            .put("max_tokens", request.maxTokens)
            .put("messages", messagesJson)
            .put("stream", stream)

        outputStream.bufferedWriter().use { writer ->
            writer.write(payload.toString())
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
