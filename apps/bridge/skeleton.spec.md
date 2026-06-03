# spec: apps/bridge/skeleton

> See `docs/WALKING-SKELETON-SPEC.md` v7 for full context.
> Architecture: **Qiniu-as-Signaling**. No WebSocket, no IP, no direct connection.

## 数据流

```
[App 端 已实现]
  AudioRecorder.startStream(pcm16 @ 24kHz)
    → ChatVoiceRecorder._vmBuffer.addAll(chunk)    [C10]
    → LmdnProcessor.processMicrophoneInput(pcm)    [C11]  ← lmdn encode
    → QiniuDirectClient.putBinary("oc/chat/$chatId/$ts.enc")  [C12]

[Bridge skeleton.mjs polling loop]
  setInterval(2s) → qiniuList("oc/chat/")
    → 发现 *.enc 或 *.msg (非 -reply) 新 key        [C13]
    → qiniuGet(key)
    → if .enc: SkeletonCodec.decode → PCM @ 24kHz  [C13b]
              STT (v0: hard-code "你好")             [C13c]
    → if .msg: parse EPC BB 00 DD payload JSON → text [C13c']
    → processText(text) → agent.processStream       [C13d]  ← TOOL_CALL
    → qiniuPut("oc/chat/$chatId/$ts-reply.json")   [C13e]
       payload: { text, toolCalls, sourceKey, ts }

[App 端 需加 ~30 行 polling]
  setInterval(2s) → qiniu listFiles("oc/chat/$chatId/")
    → 发现 *-reply.json 新 key
    → qiniu getBinary(key) → utf8 → jsonDecode     [C14]
    → setState 添加 AI 文本气泡                     [💬]
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

// apps/bridge/skeleton.mjs (main, polling)
async function processEnc(key);   // 单条 .enc → reply.json
async function pollLoop();        // 2s 轮询 oc/chat/
async function primeSeenKeys();   // 启动时标记已存在文件，防止重放历史
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 启动时 oc/chat/ 已有大量 .enc/.msg | primeSeenKeys 标为已读，不重放历史 |
| qiniuGet 返回空 | log warn, skip |
| .enc 头不是 BB 01 CC | log error, skip |
| .msg 头不是 BB 00 DD | log error, skip |
| .msg JSON payload 解析失败 | log error, skip |
| agent 抛异常 | reply.json 含 `error` 字段，仍上传给 App 显示 |
| agent 不调用任何工具 | toolCalls 数组为空，仍发 reply.json |
| 同一 .enc 重复被 list | seenKeys 去重，只处理一次 |
| Qiniu list 失败 | log + 等下次轮询，不 crash |

## 文件清单

| 文件 | 职责 | 关键依赖 |
|------|------|---------|
| `apps/bridge/skeleton-codec.mjs` | fork `lpc-mdct-codec.js` + SR=24000 + frame 公式 | 无 |
| `apps/bridge/skeleton-qiniu.mjs` | list / get / put 最小封装 | `bridge/src/core/qiniu-signaling.js` 中 _ak/_sk |
| `apps/bridge/skeleton-agent.mjs` | 调 agent-engine + 捕获 TOOL_CALL | `bridge/src/core/agent/agent-engine.js` |
| `apps/bridge/skeleton.mjs` | 主轮询循环 + 处理 .enc → reply.json | 上述三个 |
| `apps/bridge/self-check.mjs` | 正弦波 round-trip 验证 | skeleton-codec |
| `apps/bridge/test-real-enc.mjs` | 拉真实 Qiniu .enc 试解码 | skeleton-codec + skeleton-qiniu |

// === invariants ===
// - skeleton-codec.mjs SR=24000 不可改回 48000
// - 跨设备数据 100% 走 Qiniu，禁止 WebSocket / 直连 / IP 依赖
// - reply 是 JSON 文本，文件名必须含 -reply 后缀
// - .enc 后缀 (EPC BB 01 CC) → 走 lmdn 解码
// - .msg 后缀 (EPC BB 00 DD) → 文本消息，payload 为 JSON
// - -reply.json 后缀 → 输出，App 端 only watch this
// - 禁止 TTS（agent 输出本来就是文本）
// - Bridge 可以跑在任意地点（PC/云/NAS），手机无需知道其 IP
