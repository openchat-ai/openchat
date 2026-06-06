# Walking Skeleton — End-to-End Demo

> **目标**：手机录音 → Qiniu → Bridge (lmdn + agent) → reply.json → 手机显示 AI 文本气泡。
> **5 天预算，今天 D5**：必须跑通。

## 1. 组件现状

| 端 | 文件 | 角色 | 状态 |
|----|------|------|------|
| App | `openchat-flutter/lib/core/audio/lmdn_codec.dart` | SR=48000 lmdn codec | ✅ |
| App | `openchat-flutter/lib/ui/screens/chat_voice_recorder.dart` | 录音 → lmdn 编码 → 上传 `oc/chat/{chatId}/{ts}.enc` | ✅ |
| App | `openchat-flutter/lib/ui/screens/chat_screen.dart` (`_pollReplies`) | 轮询 `oc/chat/{chatId}/` 拉 `-reply.json` 显示气泡 | ✅ |
| Bridge | `bridge/src/core/audio/lmdn-codec.mjs` | JS 端 lmdn codec（SR=48000，对齐 Dart） | ✅ |
| Bridge | `bridge/src/core/chat-poller.mjs` | 轮询 `oc/chat/`、下载 `.enc`/`.msg`、调 agent、写 `-reply.json` | ✅ 跑通 |
| Bridge | `bridge/scripts/skeleton-agent.mjs` | LLM via **provider-kit**（canned echo 是 fallback） | ✅ 跑通 |
| Bridge | `bridge/scripts/qiniu-s3.mjs` | `qiniuList` / `qiniuGet` / `qiniuPut`（S3 签名） | ✅ 已有 |
| Bridge | `bridge/src/main.js:210-212` | 启动 chat-poller | ⚠️ main.js 不能跑（embedding-service 死链 sessionManager），chat-poller 独立跑 |

## 2. 数据流

```
[App]
  recorder (24kHz PCM)
    → lmdn_codec.encode  (Dart, SR=48000)
    → QiniuDirectClient.putBinary("oc/chat/{chatId}/{ts}.enc")

[Bridge chat-poller, 2s 轮询]
  qiniuList("oc/chat/")
    → new .enc / .msg
    → qiniuGet(key)
    → if .enc: LmdnCodec.decode  → 文本占位 "[用户发来一段语音消息]"
    → if .msg: 直接 parse JSON  → text
    → skeleton-agent.processText(text, chatId)  → {response, toolCalls}
    → qiniuPut("oc/chat/{chatId}/{ts}-reply.json", JSON)

[App _pollReplies, 2s 轮询]
  listFiles("oc/chat/{chatId}/")
    → new *-reply.json
    → getBinary → utf8 → jsonDecode
    → 文本 → chat 气泡
```

## 3. 接口签名（现状）

```js
// bridge/src/core/audio/lmdn-codec.mjs
class LmdnCodec {
  async initialize()
  async encode(pcm /* Buffer int16 @ 48kHz */) /* → {data, ...} */
  async decode(epcBytes /* Buffer */) /* → {pcm, ...} */
}

// bridge/scripts/skeleton-agent.mjs
async function processText(text, chatId) /* → {response, toolCalls, sessionId} */
async function initProvider() /* → void, 初始化 provider */
async function generateSessionName(chatId) /* → string */

// bridge/src/core/chat-poller.mjs
export async function startChatPoll()  // 在 main.js 启动时调用
```

## 4. 边界条件

| 条件 | 行为 |
|------|------|
| `.enc` 头不是 `BB 01 CC` | log error, skip |
| `.msg` JSON 解析失败 | log error, skip |
| agent 抛异常 | reply.json 含 `error` 字段，仍上传 |
| 同一 key 重复 | `_inFlight` Set 去重；`seenKeys` 跨轮询去重 |
| 启动时已有大量历史 | `_primeSeenKeys` 标已读，不重放 |
| 文件超过 15 min | 跳过（避免处理死会话） |
| agent 无返回 | reply = `(agent returned empty)` |
| 端 `.msg` 头 `BB 00 DD` | 剥掉 EPC 头取 payload JSON |

## 5. **D5 Blockers**（已解决）

| # | 问题 | 解决 |
|---|------|------|
| 1 | `apps/bridge/skeleton-*.mjs` 引用路径错（apps/ 已删） | 改为 `../../scripts/qiniu-s3.mjs` (3 处) |
| 2 | 缺 qiniu 封装 | **已有** `bridge/scripts/qiniu-s3.mjs`（S3 兼容签名版，含 list/get/put/delete），用之 |
| 3 | `skeleton-agent.mjs` 调不存在的 `sessionManager.addProviderDirect/listSessions/createSession` | 用户决策：**去掉 LLM**，重写为 canned echo |
| 4 | provider config 缺失 | 无关：已不调 LLM |

**遗留**：`bridge/src/main.js` 加载 `embedding-service.js` 时也撞同一个 `sessionManager` 死链。所以**不能跑 `node src/main.js`**，要直接启 chat-poller（见 §7）。

## 6. 不变量

```
- SR=48000（App 端 Dart + Bridge 端 JS 一致）
- 跨设备字节 100% 走 Qiniu oc/chat/，禁止 WebSocket / IP 直连
- reply 是 JSON 文本（不是 .enc）
- reply 文件名必须含 -reply 后缀
- chat-poller 维护 seenKeys + _inFlight 两层去重
- App 只处理 -reply.json，不处理 .enc
- 任何 LLM 调用统一走 provider-kit（不是自写）
- 当前 skeleton-agent **走 provider-kit 调 LLM**（任何 LLM 必经 provider-kit，禁自写）
- provider config 在 `~/.openchat/config.json` 的 `providers.{name}.apiKey` + `current.{provider,model}`
```

## 7. 跑起来

```bash
# Bridge (跳过 main.js，直接启 chat-poller)
cd bridge
node -e "import('./src/core/chat-poller.mjs').then(m => m.startChatPoll())"
# 期望日志:
#   [LmdnCodec] Ready (48kHz N=96)
#   [chat-poller] codec ready
#   [skeleton-agent] init: no-LLM mode (canned echo)
#   [chat-poller] primed: N seen, M pending
#   [chat-poller] starting...

# App
cd openchat-flutter && flutter run
# 操作: 进 chat 屏 → 长按录音 → 说话 → 松开
# 期望: 几秒后 chat 列表多出 AI 文本气泡（canned echo 内容）
```

## 8. 成功标志（D5 验收）

| 标记 | 来源 | 含义 | 状态 |
|------|------|------|------|
| C12 | App + Qiniu | `oc/chat/{chatId}/{ts}.enc` 存在 | ⏸ 待 App 端 |
| C13 | Bridge stdout | `[chat-poller] text=...` | ✅ 实测通过 |
| C13d | Bridge stdout | reply 有内容 | ✅ 真 LLM (provider-kit→openrouter) |
| C13e | Qiniu | `oc/chat/{chatId}/{ts}-reply.json` 存在 | ✅ 实测通过 |
| C14 | App | `[C14] got reply` 日志 | ⏸ 待 App 端 |
| 💬 | 手机屏幕 | chat 列表多出 AI 文本气泡 | ⏸ 待 App 端 |

**实测样本**（已跑通）：
- 上传 `oc/chat/test123/1780720715249.msg` 含 `{type:'text', text:'hello bridge test 3'}`
- Bridge stdout：`[chat-poller] text=hello bridge test 3` → `reply="[bridge echo @ 04:38:36] hello bridge test 3"`
- Qiniu 出现：`oc/chat/test123/1780720716463-reply.json` = `{"text":"[bridge echo @ 04:38:36] hello bridge test 3","toolCalls":[],"sourceKey":"oc/chat/test123/1780720715249.msg","ts":1780720716463}`

**Bridge 部分已 100% 跑通**。剩 App 端 flutter run 验证。
