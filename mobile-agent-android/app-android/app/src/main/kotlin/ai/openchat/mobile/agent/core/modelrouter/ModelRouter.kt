package ai.openchat.mobile.agent.core.modelrouter

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

class ModelRouter(private val providers: List<ModelProvider>) {

    init {
        require(providers.isNotEmpty()) { "ModelRouter requires at least one provider" }
    }

    suspend fun ask(request: ModelRequest): ModelResponse {
        for (provider in providers) {
            val response = provider.ask(request)
            if (response.isSuccess) return response
        }
        return ModelResponse(error = "all providers failed")
    }
}
