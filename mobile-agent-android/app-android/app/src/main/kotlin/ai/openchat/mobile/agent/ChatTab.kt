package ai.openchat.mobile.agent

import org.json.JSONArray
import org.json.JSONObject

data class ChatTab(
    val id: String = "tab-${System.currentTimeMillis().toString().takeLast(8)}",
    val name: String = "Chat",
    val askHistory: List<AskTurn> = emptyList(),
    val mode: RuntimeMode = RuntimeMode.ASK,
)

fun ChatTab.toJson(): JSONObject = JSONObject()
    .put("id", id)
    .put("name", name)
    .put("mode", mode.name)
    .put("askHistory", JSONArray().apply {
        askHistory.forEach { turn ->
            put(JSONObject()
                .put("role", turn.role)
                .put("content", turn.content))
        }
    })

fun JSONObject.toChatTab(): ChatTab = ChatTab(
    id = optString("id", "tab-${System.currentTimeMillis().toString().takeLast(8)}"),
    name = optString("name", "Chat"),
    mode = runCatching { RuntimeMode.valueOf(optString("mode", RuntimeMode.ASK.name)) }
        .getOrDefault(RuntimeMode.ASK),
    askHistory = optJSONArray("askHistory")?.let { arr ->
        buildList {
            for (i in 0 until arr.length()) {
                arr.optJSONObject(i)?.let { obj ->
                    add(AskTurn(
                        role = obj.optString("role", "You"),
                        content = obj.optString("content"),
                    ))
                }
            }
        }
    } ?: emptyList(),
)
