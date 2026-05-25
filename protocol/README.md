# PeerTalk 协议定义

Bridge ↔ Client 通信协议规范。

## 1. WebSocket 聊天协议 (`/ws`)

### 连接

```
ws://<host>:<port>/ws?token=<auth_token>
```

服务端连接后立即发送 `bridge_handshake`。

### 消息格式

```json
{
  "id": "uuid",
  "type": "message_type",
  "sessionId": "optional_session_id",
  "data": {},
  "timestamp": 1717000000000
}
```

### 消息类型

| 类型 | 方向 | 说明 |
|------|------|------|
| `bridge_handshake` | Server→Client | 连接握手，含 `peerId` |
| `bridge_status` | Server→Client | 状态推送 |
| `chat` | Client→Server | 发送消息 |
| `chat_response` | Server→Client | AI 响应 |
| `chat_stream` | Server→Client | 流式响应块 |
| `chat_stream_end` | Server→Client | 流式结束 |
| `message` | 双向 | P2P 消息 (含 `data.to`) |
| `error` | 双向 | 错误消息 |
| `memory_save` | Client→Server | 保存记忆 |
| `memory_query` | Client→Server | 查询记忆 |
| `memory_stats` | Server→Client | 记忆统计 |
| `agent_spawn` | Client→Server | 生成 Agent |
| `agent_list` | 双向 | Agent 列表 |
| `agent_terminate` | Client→Server | 终止 Agent |

### 错误码

| Code | HTTP 等价 | 说明 |
|------|-----------|------|
| `UNAUTHORIZED` | 401 | token 无效 |
| `RATE_LIMITED` | 429 | 超过 20 msg/s 限流 |
| `PEER_NOT_FOUND` | 404 | 目标 peer 不在线 |
| `INVALID_MESSAGE` | 400 | 消息格式错误 |
| `INTERNAL_ERROR` | 500 | 服务端内部错误 |
| `SESSION_NOT_FOUND` | 404 | Session ID 无效 |
| `PROVIDER_UNAVAILABLE` | 503 | LLM provider 不可用 |
| `MEMORY_FULL` | 507 | 记忆超过上限 |

### 限流规则

- 每连接 20 条/秒
- 超出返回 `{ type: "error", data: { code: "RATE_LIMITED", message: "rate limit exceeded" } }`
- 每 1 秒窗口重置计数

### 重连协议

1. 客户端指数退避重连：2s → 4s → 6s → ... → 最大 30s
2. 重连后重新发送 `bridge_handshake` 或 register
3. 服务端对新连接分配新 `peerId`
4. 旧连接关闭后清理 signalingRooms

---

## 2. WebSocket 信令协议 (`/signaling`)

用于 WebRTC 通话的信令交换。

### 连接

```
ws://<host>:<port>/signaling
```

### 注册

```json
// Client → Server
{ "type": "signaling_message", "data": { "action": "register", "peerId": "peer-001" } }

// Server → Client
{ "type": "signaling_message", "data": { "action": "registered", "peerId": "peer-001" } }
```

### 通话控制

**发起通话：**
```json
// Caller → Server
{ "type": "signaling_message", "data": { "action": "call-request", "toPeerId": "peer-002", "roomId": "room-001" } }
// Server → Callee
{ "type": "signaling_message", "data": { "action": "call-request", "fromPeerId": "peer-001", "roomId": "room-001" } }
```

**接受通话：**
```json
// Callee → Server
{ "type": "signaling_message", "data": { "action": "call-accept", "toPeerId": "peer-001", "roomId": "room-001" } }
// Server → Caller
{ "type": "signaling_message", "data": { "action": "call-accept", "fromPeerId": "peer-002", "roomId": "room-001" } }
```

**拒绝通话：**
```json
// Callee → Server
{ "type": "signaling_message", "data": { "action": "call-reject", "toPeerId": "peer-001" } }
// Server → Caller
{ "type": "signaling_message", "data": { "action": "call-reject", "fromPeerId": "peer-002" } }
```

**结束通话：**
```json
// 任一方 → Server
{ "type": "signaling_message", "data": { "action": "call-end", "toPeerId": "peer-002" } }
// Server → 对方
{ "type": "signaling_message", "data": { "action": "call-end", "fromPeerId": "peer-001" } }
```

**Peer 不在线：**
```json
// Server → Caller
{ "type": "signaling_message", "data": { "action": "call-error", "message": "Target peer not available" } }
```

### WebRTC 信令

**Offer：**
```json
{ "type": "signaling_message", "data": { "action": "offer", "toPeerId": "peer-002", "sdp": { "sdp": "...", "type": "offer" } } }
```

**Answer：**
```json
{ "type": "signaling_message", "data": { "action": "answer", "toPeerId": "peer-001", "sdp": { "sdp": "...", "type": "answer" } } }
```

**ICE Candidate：**
```json
{ "type": "signaling_message", "data": { "action": "ice-candidate", "toPeerId": "peer-002", "candidate": { "candidate": "...", "sdpMid": "0", "sdpMLineIndex": 0 } } }
```

**Signal 转发失败：**
```json
{ "type": "signaling_message", "data": { "action": "signal-error", "message": "Target peer not connected" } }
```

---

## 3. REST API

### 信令 API (`/api/v1/signaling/`)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/request-room` | 申请房间 |
| GET | `/room/:roomId` | 查询 Offer |
| POST | `/room/:roomId/offer` | 写入 Offer |
| POST | `/room/:roomId/answer` | 写入 Answer |
| POST | `/room/:roomId/ice` | 写入 ICE |
| GET | `/room/:roomId/ice` | 读取 ICE |
| DELETE | `/room/:roomId` | 释放房间 |
| GET | `/token` | 获取上传 Token |

### P2P API (`/api/v1/p2p/`)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/messages` | 广播消息 |
| GET | `/peers` | 在线 Peer 列表 |
| GET | `/stats` | 网络统计 |

### Voice API (`/api/v1/voice/`)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/rooms` | 创建房间 |
| GET | `/rooms` | 房间列表 |
| POST | `/rooms/:id/join` | 加入房间 |
| POST | `/rooms/:id/leave` | 离开房间 |
| POST | `/rooms/:id/signal` | 发送信令 |
| POST | `/rooms/:id/mode` | 切换模式 |
| GET | `/rooms/:id` | 房间详情 |

### Health / Metrics

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/metrics` | 指标 |
| GET | `/live` | 实时聊天页面 |

---

## 4. P2P 协议 (Bridge ↔ Bridge)

通过 Hyperswarm DHT 传输，消息格式：

```json
{
  "type": "message_type",
  "id": "uuid",
  "payload": {},
  "priority": 0,
  "source": "bridge_xxx",
  "target": "bridge_yyy",
  "timestamp": 1717000000000,
  "ttl": 60,
  "metadata": {}
}
```

### 消息类型

- `skill_publish` / `skill_request`
- `collaboration_request` / `collaboration_response`
- `insight_share`
- `bridge_spawn` / `bridge_upgrade` / `resident_transfer`
- `fairy_gossip`
- `llm_proxy_request` / `llm_proxy_response`

### 身份交换

连接建立后发送 IDENTITY 消息：
```json
{
  "name": "bridge-name",
  "region": "us-east",
  "residentCount": 1,
  "wsSignalingUrl": "ws://host:port/signaling"
}
```

## 5. Flutter 客户端通信架构

```
┌─────────────────┐     WS /ws      ┌──────────────┐
│  BridgeWsClient  │ ←─────────────→ │  Bridge       │
│  (Chat/Agent)    │                 │  (Node.js)    │
└─────────────────┘                 └──────┬───────┘
                                          │
┌─────────────────┐     WS /signaling     │
│ WsSignalingClient│ ←───────────────────→│
│ (WebRTC Signaling)│                    │
└────────┬────────┘                      │
         │ WebRTC                        │
         │ (RTCPeerConnection)           │
         ▼                               │
┌─────────────────┐                      │
│ VoiceClient      │ ←─── REST ──────────│
│ (Audio/WebRTC)   │                     │
└─────────────────┘                     │
                                         │
┌─────────────────┐     REST API         │
│ QiniuSignaling   │ ←─────────────────→│
│ (Qiniu Fallback  │                     │
└─────────────────┘                     │
