# spec: chat-poller.mjs
> Bridge 轮询 Qiniu → LLM 推理 → EPC 响应 + BYPASS 检测门

## 数据流
```
Qiniu LIST oc/chat/{chatId}/ → .epc 文件
     │
     ▼
parseMsgPayload → provider.chatStream / .chat
     │
     ├── 流式: processStream
     │     每个 chunk:
     │       ENTRY: rawText ← chunk.content
     │       encodeEpcFrame → validateEpcFrame ← EXIT
     │       ├── OK → epcBuf 累加
     │       └── FAIL → bypassText += rawText（零处理）
     │     最终: stream.bin(逐chunk) + reply.epc(meta含bypass/bypassText)
     │
     └── 非流式: processNonStream
            r.epc → validateEpcBuffer ← EXIT
            ├── OK → passthrough
            └── FAIL → bypassText = r.content（零处理）
            最终: reply.epc(meta含bypass/bypassText)
```

## 接口签名
```js
function validateEpcFrame(buf)          → boolean  // 单帧结构校验
function validateEpcBuffer(buf)          → boolean  // 多帧遍历校验
function inspectEpc(buf)                 → {frames, types, totalBytes}
function sha8(buf)                       → string   // 8-char hash
async function startChatPoll()           → void     // 入口
async function pollOnce(p)               → void     // 单轮 LIST
async function processOne(p, key)        → void     // 处理单个 .epc
async function processStream(...)        → void     // 流式 LLM + BYPASS
async function processNonStream(...)     → void     // 非流式 LLM + BYPASS
```

## BYPASS 门行为
| 条件 | 行为 |
|------|------|
| encodeEpcFrame 输出通过 validateEpcFrame | 帧累加到 epcBuf |
| encodeEpcFrame 输出未通过 validateEpcFrame | bypassText += rawText，不写帧 |
| r.epc 通过 validateEpcBuffer | passthrough 透传 |
| r.epc 未通过 validateEpcBuffer | raw content 写入 meta.bypassText，epcBuf 空 |
| p.chat() 抛出异常 | error 帧写入 reply.epc |

## 边界条件
| 条件 | 预期 |
|------|------|
| Qiniu LIST 抛异常 | catch return，下一轮重试 |
| .epc 为空或格式错误 | return 跳过 |
| chatStream 抛异常 | catch → fallback 到 processNonStream |
| stream.bin qiniuPut 抛异常 | catch 吞，epcBuf 继续累积 |
| stream.bin qiniuDelete 抛异常 | catch 吞，reply.epc 已写入 |
| byPassText 为空 | meta.bypassText = undefined，Flutter 走正常 content 路径 |

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| bridge/src/core/chat-poller.mjs | 轮询 + BYPASS 门 | 220 |
| bridge/src/core/core-config.mjs | 配置读取 | — |
| modules/provider-kit/src/providers/epc-codec.js | EPC 编解码 | — |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|------------|------|
| C1 | `[C1] stream` | stream ts={ts} done bypass={bool} |
| C1 | `[C1] nonstream` | nonstream {key} mode={mode} bypass={bool} |
| C1 | `[C1] fail:` | .epc 处理失败 |

## 不变量
- encodeEpcFrame 输出必须经过 validateEpcFrame 校验
- BYPASS 时 raw text 存 meta.bypassText，不调 encodeEpcFrame
- startupTs 过滤重启前的旧 .epc（设计取舍）
- seenKeys 在内存中，重启后重建
- POLL_MS=3000 固定间隔
