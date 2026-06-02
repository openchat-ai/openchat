# spec: apps/bridge/skeleton

> See `docs/WALKING-SKELETON-SPEC.md` v6 for full context.

## 数据流

```
[App 端 已实现]
  AudioRecorder.startStream(pcm16 @ 24kHz)
    → ChatVoiceRecorder._vmBuffer.addAll(chunk)    [C10]
    → LmdnProcessor.processMicrophoneInput(pcm)    [C11]  ← lmdn encode
    → QiniuDirectClient.putBinary("oc/chat/$chatId/$ts.enc")  [C12]
    → BridgeWsClient.sendJson({type:'voice_msg', data:{key, sessionId}})

[Bridge skeleton.mjs 待实现]
  WebSocketServer on :3800/ws
    on 'voice_msg' { key, sessionId }
    → qiniuGet(key)                                [C13]
    → SkeletonCodec.decode → PCM @ 24kHz           [C13b]
    → STT (v0: hard-code "你好")                   [C13c]
    → processText(text) → agent.processStream      [C13d]  ← TOOL_CALL
    → ws.send({type:'chat_response', data:{content, sessionId}, sessionId}) [C13e]

[App 端 已实现]
  BridgeWsClient.messages.listen
    on 'chat_response' → _messages.add(ai_text)    [C14]
    → ChatBubble renders                            [💬]
```

## 接口签名

```js
// apps/bridge/skeleton-codec.mjs
class SkeletonCodec {
  async initialize();
  async encode(pcm /* Buffer @ 24kHz int16 */) /* → {data: Buffer, frameCount} */;
  async decode(epcBytes /* Buffer */) /* → {pcm: Buffer, score: ScoreNote[]} */;
}

// apps/bridge/skeleton-qiniu.mjs
async function qiniuList(prefix) /* → string[] */;
async function qiniuGet(key) /* → Buffer */;
async function qiniuPut(key, data) /* → void */;

// apps/bridge/skeleton-agent.mjs
async function processText(text /* string */) /* → {response, toolCalls} */;

// apps/bridge/skeleton.mjs (main, WS server)
async function handleVoiceMsg(ws, msg);   // voice_msg → chat_response
async function handleTextChat(ws, msg);   // chat → chat_response (text fallback)
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| voice_msg missing data.key | log error, return |
| qiniuGet 返回空 | log warn, skip |
| .enc 头不是 BB 01 CC | log error, skip |
| agent 抛异常 | ws.send chat_response 含 `❌ Error: ...` |
| agent 不调用任何工具 | toolCalls 数组为空，仍发 reply text |
| WS 客户端断连 | server 不 crash，等待重连 |
| 未知 msg.type | 忽略，不报错 |

## 文件清单

| 文件 | 职责 | 关键依赖 |
|------|------|---------|
| `apps/bridge/skeleton-codec.mjs` | fork `lpc-mdct-codec.js` + SR=24000 + frame 公式 | 无 |
| `apps/bridge/skeleton-qiniu.mjs` | list / get / put 最小封装 | `bridge/src/core/qiniu-signaling.js` 中 _ak/_sk |
| `apps/bridge/skeleton-agent.mjs` | 调 agent-engine + 捕获 TOOL_CALL | `bridge/src/core/agent/agent-engine.js` |
| `apps/bridge/skeleton.mjs` | WS server on :3800, 路由 voice_msg/chat | 上述三个 + `ws` npm |
| `apps/bridge/self-check.mjs` | 正弦波 round-trip 验证 | skeleton-codec |
| `apps/bridge/test-real-enc.mjs` | 拉真实 Qiniu .enc 试解码 | skeleton-codec + skeleton-qiniu |

// === invariants ===
// - skeleton-codec.mjs SR=24000 不可改回 48000
// - 跨设备音频字节必须经过 lmdn (App 端 LmdnProcessor, Bridge 端 SkeletonCodec)
// - voice_msg.data.key 必须形如 oc/chat/$chatId/$ts.enc
// - chat_response.sessionId 必须 echo voice_msg.sessionId
// - 禁止 TTS、禁止 reply.enc 上传（reply 走 WS 文本，agent 输出本来就是文本）
// - 启动 skeleton 前必须停掉 main Bridge（同样监听 :3800）
