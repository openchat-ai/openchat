package ai.openchat.mobile.agent.core.github

import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ThreadLocalRandom
import kotlinx.coroutines.delay

object GithubHttp {

    private const val MAX_DELAY_MS = 15000L
    private const val BASE_DELAY_MS = 1000L
    private const val DEFAULT_MAX_RETRIES = 3

    suspend fun fetchWithRetry(
        token: String,
        urlStr: String,
        accept: String,
        connectTimeout: Int = 10000,
        readTimeout: Int = 30000,
        maxRetries: Int = DEFAULT_MAX_RETRIES,
    ): String {
        var lastCode = -1
        var lastError: Throwable? = null

        for (attempt in 0..maxRetries) {
            try {
                val response = fetchOnce(token, urlStr, accept, connectTimeout, readTimeout)
                if (response.code in 200..299) return response.body
                lastCode = response.code
                if (!shouldRetry(response.code)) {
                    throw IOException(
                        "GitHub API returned HTTP ${response.code}: ${response.body.take(200)}"
                    )
                }
                delay(backoffDelay(attempt, response.retryAfterSeconds))
            } catch (e: IOException) {
                lastError = e
                if (attempt < maxRetries) {
                    delay(backoffDelay(attempt, null))
                }
            }
        }

        throw IOException(
            "GitHub API request failed after ${maxRetries} retries " +
            "for ${urlStr.take(80)} (HTTP $lastCode, error: ${lastError?.message})"
        )
    }

    private data class HttpResponse(val code: Int, val body: String, val retryAfterSeconds: Long?)

    private fun fetchOnce(
        token: String,
        urlStr: String,
        accept: String,
        connectTimeout: Int,
        readTimeout: Int,
    ): HttpResponse {
        val url = URL(urlStr)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            this.connectTimeout = connectTimeout
            this.readTimeout = readTimeout
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Accept", accept)
            setRequestProperty("X-GitHub-Api-Version", "2022-11-28")
            setRequestProperty("User-Agent", "OpenChat-Android-Agent")
        }
        return try {
            val code = connection.responseCode
            val retryAfter = connection.getHeaderField("Retry-After")?.toLongOrNull()
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = if (stream == null) ""
                else BufferedReader(InputStreamReader(stream)).use { it.readText() }
            HttpResponse(code, text, retryAfter)
        } finally {
            connection.disconnect()
        }
    }

    private fun shouldRetry(code: Int): Boolean =
        code == 429 || code in 500..599

    private fun backoffDelay(attempt: Int, retryAfterSeconds: Long?): Long {
        if (retryAfterSeconds != null && retryAfterSeconds > 0) return retryAfterSeconds * 1000L
        val base = BASE_DELAY_MS * (1L shl attempt)
        return minOf(base + ThreadLocalRandom.current().nextLong(0, base / 2 + 1), MAX_DELAY_MS)
    }
}
