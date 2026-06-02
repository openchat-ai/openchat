# spec: apps/bridge/skeleton

## 数据流
（参考 WALKING-SKELETON-SPEC.md §2，或直接引用）

```
[App 端 已实现]
  AudioRecorder.startStream(pcm16 @ 24kHz)
    → ChatVoiceRecorder._vmBuffer.addAll(chunk)    [C10]
    → LmdnProcessor.processMicrophoneInput(pcm)    [C11]  ← lmdn encode
    → QiniuDirectClient.putBinary("oc/chat/$chatId/$ts.enc")  [C12]

[Bridge 端 待实现]
  pollQiniuList("oc/chat/")
    → 发现 *.enc 新 key
    → qiniuDownload(key)                           [C13]
    → lpcMdctCodec.decode(bytes) → PCM @ 24kHz     [C13b]  ← fork 后的 24kHz 版本
    → stt(pcm) → text                              [C13c]  ← v0: hard-code "你好"
    → agentEngine.processStream(text)              [C13d]  ← 必触发 TOOL_CALL
    → tts(reply) → PCM @ 24kHz                     [C13e]  ← v0: PowerShell SAPI
    → lpcMdctCodec.encode(replyPcm) → bytes        [C13f]
    → qiniuUpload("oc/chat/$chatId/$ts-reply.enc")

[App 端 已实现]
  ChatVoicePlayer.playKey(replyKey)
    → QiniuDirectClient.getBinary(replyKey)        [C14]
    → LmdnProcessor.processPlaybackAudio(raw) → PCM
    → AudioPlayer.play(pcm)
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

// apps/bridge/skeleton-tts.mjs
async function tts(text /* string */) /* → Buffer pcm16 @ 24kHz */;

// apps/bridge/skeleton.mjs (main)
async function processChatEnc(key);   // 单条 .enc → reply.enc 完整链路
async function pollLoop();             // 1s 轮询 oc/chat/
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 手机上传 0 字节 .enc | Bridge 跳过（log warn），不调 agent |
| .enc 头不是 BB 01 CC | log error + 跳过 + 不调 agent |
| agent 不调用任何工具 | log warn，仍可继续生成 reply（但记入失败统计） |
| TTS 失败 | reply.enc 不上传，标记此 reqId 失败 |
| reply.enc 已存在（重复处理） | Bridge 维护 seenKeys Set 去重 |
| App 重复轮询同一 chatId | Bridge 端文件名含时间戳，App 端用最近一条 |

## 文件清单

| 文件 | 职责 | 关键依赖 |
|------|------|---------|
| `apps/bridge/skeleton-codec.mjs` | fork `lpc-mdct-codec.js` + SR=24000 + 修 frame 数公式 | 无 |
| `apps/bridge/skeleton-qiniu.mjs` | list / get / put 最小封装 | 复用 `bridge/src/core/qiniu-signaling.js` 中 _ak/_sk 默认值 |
| `apps/bridge/skeleton-tts.mjs` | TTS 适配 | PowerShell SAPI / edge-tts CLI / ffmpeg+espeak |
| `apps/bridge/skeleton-agent.mjs` | 调 agent-engine + 注册 1 个工具 | `bridge/src/core/agent/agent-engine.js` + provider-kit |
| `apps/bridge/skeleton.mjs` | 主循环 + 编排 | 上述四个 |

// === invariants ===
// - skeleton-codec.mjs SR=24000 不可改
// - 跨设备字节必须经 lmdn
// - reply 文件名必须含 -reply 后缀
