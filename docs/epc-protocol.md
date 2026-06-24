# spec: EPC Protocol
> 全二进制帧协议，为 AI 与终端间的所有操作提供确定性的 opcode 映射。
> 每一条指令都有唯一的 `(Type, Sub)` 组合，AI 按字节数组直接匹配，无需 JSON 解析。

## 帧结构

与 Flutter `lmdn_codec.dart` 一致：

```
BB [Type(1)] [Sub(1)] [PL(3BE)] [Payload(PL)] [XOR-CS(1)] 7E(1)
```

| 字段 | 长度 | 说明 |
|------|------|------|
| `0xBB` | 1B | 帧起始标记 |
| Type | 1B | 域名（0x10-0x24, 0xFD-0xFF） |
| Sub | 1B | 操作码 |
| PL | 3B | payload 长度（大端，max 16MB） |
| Payload | PL | UTF-8 文本或二进制 |
| CS | 1B | 校验和：XOR bytes[1..(6+PL)] |
| `0x7E` | 1B | 帧结束标记 |

多帧串联：一个 Buffer 可包含多个 `BB...7E` 帧，解码器自动分段。

## Type 空间

| Type | 域 | Sub 范围 | 操作数 |
|------|-----|---------|-------|
| 0x10 | LLM | 10-1F | 6 |
| 0x11 | AGENT | 20-2F | 9 |
| 0x12 | MEDIA | 30-5F | 10 |
| 0x13 | IMAGE | 40-4F | 5 |
| 0x14 | FS | 70-7F | 16 |
| 0x15 | S3 | 80-8F | 8 |
| 0x16 | EXEC | 90-9F | 10 |
| 0x17 | CHAT | F0-FF | 9 |
| 0x18 | ROOM | E0-EF | 9 |
| 0x19 | CALL | D0-DF | 9 |
| 0x1A | SIGNAL | C0-CF | 7 |
| 0x1B | SDUI | B0-BF | 12 |
| 0x1C | SECURITY | 00-0F | 7 |
| 0x1D | SYSTEM | 10-1F | 11 |
| 0x1E | DEBUG | 20-2F | 8 |
| 0x1F | FILE_XFER | 60-6F | 6 |
| 0x20 | PLUGIN | 60-6F | 6 |
| 0x21 | UI_INPUT | 50-5F | 11 |
| 0x22 | NETWORK | 30-3F | 6 |
| 0x23 | TRANSPORT | 40-4F | 9 |
| 0x24 | DB | A0-AF | 11 |
| 0x25-0xFC | 预留 | 00-FF | 55,296 空 |
| 0xFD | BIZ_EXT | 00-FF | 自定义 |
| 0xFE | EXPERIMENT | 00-FF | 实验协议 |
| 0xFF | RAW | 00-FF | JSON fallback |

## Sub 定义

### 0x10 LLM — Agent 输出

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x10 | CONTENT | UTF-8 文本回答 |
| 0x11 | THINKING | 推理过程文本 |
| 0x12 | TOOL_CALL | JSON `[{i,name,arguments}]` |
| 0x13 | TOOL_RESULT | 工具返回结果 |
| 0x14 | ERROR | 错误信息 |
| 0x16 | META | JSON `{model,usage}` |

### 0x11 AGENT — 框架事件

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x20 | AGENT_STATE | 状态名 `run`/`pause`/`stop` |
| 0x21 | TASK_START | 任务 ID |
| 0x22 | TASK_PROGRESS | 进度描述 |
| 0x23 | TASK_DONE | 任务结果 |
| 0x24 | SPAWN | JSON `{agent,task}` |
| 0x25 | JOIN | 子 agent 返回 |
| 0x26 | MEM_READ | 记忆查询文本 |
| 0x27 | MEM_WRITE | 记忆写入文本 |
| 0x28 | SESSION_EVENT | 事件 JSON |

### 0x12 MEDIA — 音视频帧

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x30 | LMDN | LMDN 编解码二进制帧 |
| 0x31 | OPUS | Opus 音频包 |
| 0x32 | PCM | 裸 PCM 数据 |
| 0x33 | VAD | 语音检测事件 |
| 0x38 | REC_START | 录音开始 |
| 0x39 | REC_STOP | 录音停止 |
| 0x3A | PLAY_START | 播放开始 |
| 0x3B | PLAY_STOP | 播放停止 |
| 0x50 | H264 | H264 NAL 单元 |
| 0x52 | MEDIA_META | 媒体元数据 JSON |

### 0x14 FS — 文件系统

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x70 | LS | 目录路径 |
| 0x71 | DIR | 目录路径（详细） |
| 0x72 | CAT | 文件路径 |
| 0x73 | READ | 文件路径（二进制） |
| 0x74 | WRITE | JSON `{path,content}` |
| 0x75 | APPEND | JSON `{path,content}` |
| 0x76 | DELETE | 路径 |
| 0x77 | COPY | JSON `{src,dst}` |
| 0x78 | MOVE | JSON `{src,dst}` |
| 0x79 | MKDIR | 路径 |
| 0x7A | RMDIR | 路径 |
| 0x7B | STAT | 路径 |
| 0x7C | CHMOD | JSON `{path,mode}` |
| 0x7D | EXISTS | 路径 |
| 0x7E | TREE | 路径 |
| 0x7F | GLOB | 通配符模式 |

### 0x17 CHAT — 文字聊天

| Sub | 常量 | Payload |
|-----|------|---------|
| 0xF0 | MSG | JSON `{from,text,ts}` |
| 0xF1 | TYPING | 用户名 |
| 0xF2 | REACTION | JSON `{msgId,emoji}` |
| 0xF3 | ATTACH | 附件 JSON |
| 0xF4 | QUOTE | JSON `{msgId,text}` |
| 0xF5 | DELETE | 消息 ID |
| 0xF6 | EDIT | JSON `{msgId,text}` |
| 0xF7 | RECEIPT | 消息 ID |
| 0xF8 | HISTORY | JSON `{chatId,limit,before}` |

### 0x18 ROOM — 语音房间

| Sub | 常量 | Payload |
|-----|------|---------|
| 0xE0 | CREATE | 房间名 |
| 0xE1 | JOIN | 房间 ID |
| 0xE2 | LEAVE | 房间 ID |
| 0xE3 | MEMBERS | 房间 ID（响应为 JSON list） |
| 0xE4 | MEMBER_IN | JSON `{roomId,peerId}` |
| 0xE5 | MEMBER_OUT | JSON `{roomId,peerId}` |
| 0xE6 | MEMBER_MUTE | JSON `{roomId,peerId}` |
| 0xE7 | SETTINGS | JSON 设置 |
| 0xE8 | INVITE | JSON `{roomId,peerId}` |

### 0x19 CALL — 通话

| Sub | 常量 | Payload |
|-----|------|---------|
| 0xD0 | IN | JSON `{from,peerId}` |
| 0xD1 | OUT | JSON `{to,peerId}` |
| 0xD2 | ACCEPT | peerId |
| 0xD3 | REJECT | peerId |
| 0xD4 | END | peerId |
| 0xD5 | MUTE | peerId |
| 0xD6 | UNMUTE | peerId |
| 0xD7 | SPEAKER | `on`/`off` |
| 0xD8 | VOLUME | `0`-`100` |

### 0x1A SIGNAL — P2P 信令

| Sub | 常量 | Payload |
|-----|------|---------|
| 0xC0 | OFFER | SDP offer JSON |
| 0xC1 | ANSWER | SDP answer JSON |
| 0xC2 | ICE | ICE candidate JSON |
| 0xC3 | PING | 时间戳 |
| 0xC4 | PONG | 时间戳 |
| 0xC5 | PRESENCE | JSON `{peerId,status}` |
| 0xC6 | PEERS | JSON 列表 |

### 0x1B SDUI — Server-Driven UI

| Sub | 常量 | Payload |
|-----|------|---------|
| 0xB0 | TREE | 完整组件树 JSON |
| 0xB1 | DIFF | 增量变更 JSON |
| 0xB2 | NAV | 路由路径 |
| 0xB3 | MODAL | 弹窗配置 JSON |
| 0xB4 | TOAST | 提示文本 |
| 0xB5 | SNACK | 提示文本 |
| 0xB6 | DIALOG | 确认框 JSON |
| 0xB7 | REFRESH | 组件 ID |
| 0xB8 | THEME | 主题名 |
| 0xB9 | LAYOUT | 布局配置 JSON |
| 0xBA | INPUT | JSON `{field,value}` |
| 0xBB | STATE | 状态 JSON |

### 0x1C SECURITY

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x00 | PUBKEY | PEM 公钥 |
| 0x01 | ENVELOPE | 加密后数据 |
| 0x02 | SIGN | 签名值 hex |
| 0x03 | AUTH | JWT |
| 0x04 | CHALLENGE | 随机数 hex |
| 0x05 | SESSION | 会话密钥 |
| 0x06 | PERM | JSON `{role,scope}` |

### 0x1D SYSTEM

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x10 | LOG | 日志行 |
| 0x11 | METRIC | JSON 指标 |
| 0x12 | CONFIG | JSON 配置变更 |
| 0x13 | ALERT | 告警消息 |
| 0x14 | HEALTH | JSON `{status}` |
| 0x15 | VERSION | 版本号 |
| 0x16 | STATUS | 服务名 |
| 0x17 | ERR_LOG | 错误日志 |
| 0x18 | WARN | 警告 |
| 0x19 | INFO | 信息 |
| 0x1A | DEBUG | 调试日志 |

### 0x1E DEBUG

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x20 | TRACE | 跟踪点 |
| 0x21 | INSPECT | 状态 dump |
| 0x22 | PROFILE | pprof 数据 |
| 0x23 | BREAK | 断点 ID |
| 0x24 | WATCH | 变量值 |
| 0x25 | STACK | 调用栈 |
| 0x26 | HEAP | 堆快照 |
| 0x27 | MEM_DUMP | 内存 dump |

### 0x1F FILE_XFER

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x60 | BLOB | 二进制块 |
| 0x61 | META | JSON `{name,size,type}` |
| 0x62 | CHUNK | 分片 ACK |
| 0x63 | XFER_START | JSON `{name,totalSize}` |
| 0x64 | XFER_DONE | 校验和 |
| 0x65 | XFER_CANCEL | 原因 |

### 0x20 PLUGIN

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x60 | LOAD | 插件名 |
| 0x61 | UNLOAD | 插件名 |
| 0x62 | EVENT | JSON 事件 |
| 0x63 | REG_TOOL | JSON 工具描述 |
| 0x64 | EXEC_TOOL | JSON `{tool,args}` |
| 0x65 | RESULT | 执行结果 |

### 0x21 UI_INPUT

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x50 | KEY_DOWN | 按键码 |
| 0x51 | KEY_UP | 按键码 |
| 0x52 | MOUSE_MOVE | JSON `{x,y}` |
| 0x53 | MOUSE_DOWN | JSON `{x,y,button}` |
| 0x54 | MOUSE_UP | JSON `{x,y,button}` |
| 0x55 | SCROLL | JSON `{x,y,dx,dy}` |
| 0x56 | TOUCH | JSON `{x,y,id}` |
| 0x57 | GESTURE | JSON `{type,params}` |
| 0x58 | CLIPBOARD | 文本 |
| 0x59 | DRAG | JSON `{x,y,data}` |
| 0x5A | DROP | JSON `{x,y,data}` |

### 0x22 NETWORK

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x30 | DISC | 发现广播 JSON |
| 0x31 | ROUTE | 路由表 JSON |
| 0x32 | SYNC | 同步数据 |
| 0x33 | GOSSIP | 流言消息 |
| 0x34 | PEER | 节点信息 JSON |
| 0x35 | TOPOLOGY | 拓扑 JSON |

### 0x23 TRANSPORT

| Sub | 常量 | Payload |
|-----|------|---------|
| 0x40 | STREAM | JSON `{action,streamId}` |
| 0x41 | ACK | 帧序号 |
| 0x42 | HEARTBEAT | 时间戳 |
| 0x43 | FLOW_CTL | JSON `{window}` |
| 0x44 | RETRY | 序号列表 |
| 0x45 | BACKPRESS | JSON `{backlog}` |
| 0x46 | CONNECT | 对端地址 |
| 0x47 | DISCONNECT | 原因 |
| 0x48 | RECONNECT | 会话 ID |

### 0x24 DB

| Sub | 常量 | Payload |
|-----|------|---------|
| 0xA0 | QUERY | SQL |
| 0xA1 | EXEC | SQL |
| 0xA2 | INSERT | JSON `{table,data}` |
| 0xA3 | UPDATE | JSON `{table,set,where}` |
| 0xA4 | DELETE | JSON `{table,where}` |
| 0xA5 | SCHEMA | JSON `{table}` |
| 0xA6 | MIGRATE | SQL |
| 0xA7 | INDEX | JSON `{table,column}` |
| 0xA8 | TX_BEGIN | session ID |
| 0xA9 | TX_COMMIT | session ID |
| 0xAA | TX_ROLLBACK | session ID |

## BYPASS 门 — 数据旁路检测

LLM 数据进入软件后，每次 EPC 编码处理必须经过旁路检测门：

```
BYPASS ENTRY: 捕获原始 LLM 文本（rawText / r.content）
     │
     ▼
EPC 编码: encodeEpcFrame / epcFromMessage
     │
     ▼
BYPASS EXIT: validateEpcFrame / validateEpcBuffer
     │
     ├── 校验通过 → 累加 frame（处理过的数据）
     │
     └── 校验失败 → bypassText += rawText（零处理，原样存 meta）
```

**验证函数：**
- `validateEpcFrame(buf)` — 单帧校验：0xBB 开头、长度字段匹配、XOR checksum、0x7E 结尾
- `validateEpcBuffer(buf)` — 多帧遍历，每帧调 validateEpcFrame

**meta 字段：**
- `bypass: true/false` — 是否触发旁路
- `bypassText: string` — 旁路时携带的原始 LLM 文本（Flutter 直接显示，不经过 EPC content 解析）

## 关键文件

| 路径 | 职责 |
|------|------|
| `modules/provider-kit/src/providers/epc-codec.js` | JS 编解码实现 + 常量 |
| `openchat-flutter/lib/core/epc_constants.dart` | Flutter 常量（与 JS 同步） |
| `openchat-flutter/lib/core/protocol/epc.dart` | Flutter EPC 帧解析/编码 + parseLlmReply 多帧拼接 |
| `openchat-flutter/lib/core/audio/lmdn_codec.dart` | LMDN 帧编码（type=0x12, sub=0x30） |
| `bridge/src/core/chat-poller.mjs` | Bridge 轮询 + BYPASS 门（validateEpcFrame/validateEpcBuffer） |
| `docs/epc-protocol.md` | 本协议参考文档 |

## 不变量

- CS 覆盖 bytes[1..(6+PL)]，不包含 0xBB
- 多帧串联时帧之间无额外分隔符
- type=0x12 sub=0x30 的 LMDN 帧，payload 必须符合 LMDN 编解码格式
- 新增操作只需分配新 opcode + 两端加常量，无需改帧结构
- AI 仅通过 `frame[1]` (type) 和 `frame[2]` (sub) 判断操作类型
- **BYPASS 门**：encodeEpcFrame 输出必须经过 validateEpcFrame 校验；校验失败时 raw text 入 meta.bypassText，零 EPC content 处理
- **parseLlmReply 流式规则**：多帧 content/reasoning 必须 `join()` 拼接，不可 `=` 覆盖（否则流式只显最后一段）
- **_seenReplyKeys 规则**：只记录 `-reply.epc` 的 key，`-stream.bin` 每轮重读（否则渐进更新永不发生）
- **poll 停判规则**：`found=true` 只对 `-reply.epc` 设（否则首条流式即停轮询）
