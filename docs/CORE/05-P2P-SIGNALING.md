# P2P 信令交换系统

> 通过七牛云存储实现手机 App 与内网 Bridge 的 P2P 连接

## 1. 系统架构

### 1.1 网络拓扑

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PeerTalk P2P 架构                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   手机 App (4G/外网)              内网电脑 (Bridge)                 │
│        │                                  │                        │
│        │  1. HTTPS 信令交换               │                        │
│        │ ────────────────────────→ 七牛云 ←─────────────────────→  │
│        │        (room-xxx/offer)          │                        │
│        │        (room-xxx/answer)         │                        │
│        │                                  │                        │
│        │  2. P2P UDP 打洞                 │                        │
│        │ ←────────── UDP ──────────────→ │                        │
│        │      (STUN + ICE)                │                        │
│        │                                  │                        │
│        │  3. P2P 直连 (成功后)             │                        │
│        │ ←───────── 数据 ───────────────→ │                        │
│        │        (WebRTC)                  │                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 七牛云存储结构

```
七牛云存储: dapin-xp
└── signaling/
    └── coordinator/
        ├── room-001/
        │   ├── offer              # 手机放 SDP offer
        │   ├── answer             # Bridge 放 SDP answer
        │   ├── ice-candidates     # ICE 候选地址
        │   └── status             # 连接状态
        ├── room-002/
        │   └── ...
        └── room-100/              # 最多 100 个房间
```

## 2. 信令流程

### 2.1 完整流程

```
┌────────────────────────────────────────────────────────────────────────┐
│ 步骤 1: 申请房间                                                       │
├────────────────────────────────────────────────────────────────────────┤
│ 手机 ──POST /api/v1/signaling/request-room──→ Bridge                 │
│                                    │                                   │
│                                 分配 room-001                          │
│                                    │                                   │
│                                 返回 roomId + URLs                    │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 步骤 2: 手机写入 Offer (SDP)                                          │
├────────────────────────────────────────────────────────────────────────┤
│ 手机 ──上传 offer.json──→ 七牛云                                      │
│        (包含: SDP, candidate 类型)                                    │
│                                                                     │
│ 内容示例:                                                             │
│ {                                                                     │
│   "type": "offer",                                                   │
│   "sdp": "v=0\r\no=- 123456789 0 IN IP4 192.168.1.1\r\n...",         │
│   "peerId": "phone_abc123",                                          │
│   "timestamp": "2026-04-27T10:30:00.000Z"                            │
│ }                                                                     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 步骤 3: Bridge 检测到新 Offer                                         │
├────────────────────────────────────────────────────────────────────────┤
│ Bridge 轮询或 webhook 收到通知                                        │
│                                                                     │
│ GET /api/v1/signaling/room/001                                       │
│ 返回: { status: "offer_received", offer: {...} }                    │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 步骤 4: Bridge 生成 Answer                                            │
├────────────────────────────────────────────────────────────────────────┤
│ Bridge 处理 offer，生成 answer，                                     │
│ 写入七牛云:                                                           │
│                                                                     │
│ POST /api/v1/signaling/room/001/answer                               │
│ body: { sdp: "...", iceCandidates: [...] }                          │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ 步骤 5: 手机获取 Answer，开始 P2P 打洞                               │
├────────────────────────────────────────────────────────────────────────┤
│ 手机读取 answer.json                                                  │
│                                                                     │
│ 双方交换 ICE candidates (通过七牛云)                                 │
│                                                                     │
│ 尝试 UDP 直连                                                        │
│ 成功 → P2P 建立                                                      │
│ 失败 → 中继兜底                                                      │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 状态机

```
┌──────────┐     手机申请      ┌──────────┐     Bridge 读取     ┌──────────────┐
│ 空闲     │ ─────────────→  │  待 Offer  │ ─────────────→  │ Offer 收到   │
└──────────┘                  └──────────┘                     └──────────────┘
       ↑                                                    │
       │                                                    │
       │                      ┌──────────┐                 │
       └─────────────────────│  释放    │←─────────────────┘
                             └──────────┘

┌──────────────┐     写入 Answer     ┌────────────┐    P2P 连接成功    ┌─────────────┐
│ Offer 收到   │ ──────────────────→│ Answer 已写│ ───────────────→  │ 已连接      │
└──────────────┘                    └────────────┘                   └─────────────┘
```

## 3. API 端点

### 3.1 信令交换

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/signaling/request-room` | 手机申请房间 |
| GET | `/api/v1/signaling/room/:roomId` | Bridge 检查新 offer |
| POST | `/api/v1/signaling/room/:roomId/answer` | Bridge 写入 answer |
| POST | `/api/v1/signaling/room/:roomId/ice` | Bridge 写入 ICE candidates |
| GET | `/api/v1/signaling/room/:roomId/ice` | 手机读取 ICE candidates |
| DELETE | `/api/v1/signaling/room/:roomId` | 释放房间 |

### 3.2 请求/响应示例

#### 申请房间
```bash
# Request
POST /api/v1/signaling/request-room
{
  "peerId": "phone_abc123",
  "capabilities": ["audio", "video", "data"]
}

# Response
{
  "success": true,
  "roomId": "001",
  "offerUrl": "https://dapin-xp.s3.cn-east-1.qiniucs.com/...",
  "message": "Room allocated"
}
```

#### Bridge 检查 Offer
```bash
# Request
GET /api/v1/signaling/room/001

# Response
{
  "roomId": "001",
  "status": "offer_received",
  "offer": {
    "type": "offer",
    "sdp": "v=0\r\no=- 123456789 0 IN IP4 192.168.1.1\r\n...",
    "peerId": "phone_abc123"
  }
}
```

#### Bridge 写入 Answer
```bash
# Request
POST /api/v1/signaling/room/001/answer
{
  "sdp": "v=0\r\no=- 987654321 0 IN IP4 192.168.1.2\r\n...",
  "iceCandidates": [
    {"candidate": "1 1 UDP 2130706431 192.168.1.2 5000 typ host", "sdpMid": "0"},
    {"candidate": "1 2 UDP 2130706431 10.0.0.1 5001 typ host", "sdpMid": "0"}
  ]
}

# Response
{
  "success": true,
  "roomId": "001",
  "message": "Answer written"
}
```

## 4. 文件清单

### 4.1 Bridge 端

| 文件 | 说明 |
|------|------|
| `bridge/src/core/qiniu-signaling.js` | 七牛云信令核心模块 |
| `bridge/src/api/routes/signaling.js` | 信令 API 路由 |
| `bridge/src/api/server.js` | 已集成信令路由 |

### 4.2 Flutter 端

| 文件 | 说明 |
|------|------|
| `openchat-flutter/lib/core/api/qiniu_signaling_client.dart` | Flutter 信令客户端 |

## 5. 技术细节

### 5.1 七牛云配置

```javascript
const config = {
  accessKey: 'jvjMR8ZC57VzT0Dh7aVzheLwKrZvHWMsqQ5HVzpG',
  secretKey: 'tfmS12VTFM_fs0NJaMRHUw09TVkWHAuZx6wb-fIq',
  bucket: 'dapin-xp',
  domain: 'https://dapin-xp.s3.cn-east-1.qiniucs.com',
  region: 'cn-east-1'
};
```

### 5.2 STUN 服务器

使用公共 STUN 服务器获取公网 IP：

```
stun.l.google.com:19302
stun1.l.google.com:19302
```

### 5.3 失败兜底

| 场景 | 处理方式 |
|------|----------|
| P2P 打洞成功 | 直接 P2P 传输 |
| P2P 打洞失败 | 通过七牛云存储转发数据 |
| 双方都是对称 NAT | 中继模式 (带宽受限) |

## 6. 安全性

### 6.1 风险点

| 风险 | 缓解措施 |
|------|----------|
| 数据经过七牛云 | 全程 HTTPS + 七牛云存储默认私有 |
| 信令被篡改 | 可加入签名验证 |
| 房间冲突 | 每个手机用唯一 peerId 隔离 |

### 6.2 建议生产环境改进

1. **访问控制**: 房间文件设置私有读写
2. **过期清理**: 自动清理超时房间 (如 5 分钟无活动)
3. **流量限制**: 防止恶意消耗七牛云配额
4. **签名验证**: 手机和 Bridge 交换签名

## 7. 数据中继模式 (已实现)

当 P2P 直连失败时，使用七牛云存储转发数据：

```
手机 ──写入 data-to-bridge.json──→ 七牛云
                                      ↓
                                  Bridge 读取
                                      ↓
手机 ←── Bridge 写入 data-to-phone.json ←── 七牛云
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/signaling/room/:roomId/data` | 手机发送数据到 Bridge |
| GET | `/api/v1/signaling/room/:roomId/data` | Bridge 检查手机数据 |
| POST | `/api/v1/signaling/room/:roomId/relay` | Bridge 发送数据到手机 (中继) |
| GET | `/api/v1/signaling/room/:roomId/relay` | 手机检查中继数据 |

### 使用示例

```dart
// 1. 手机发送数据
final client = QiniuSignalingClient(bridgeUrl: 'http://你的公网地址:3001');
await client.applyForRoom();
await client.sendDataToBridge({'command': 'run_tests'});

// 2. 手机轮询接收数据
client.onDataReceived = (data) {
  print('Received: $data');
};
client.startRelayPolling(intervalMs: 1000);
```

## 8. 后续工作

- [x] 七牛云信令交换
- [x] 数据中继转发
- [x] WebSocket 信令服务器 (/signaling)
- [x] 多核心 PeerRegistry (Qiniu + HTTP)
- [x] TCP 4字节长度头粘包修复
- [x] P2P 网络发现 (hyperswarm)
- [ ] 房间自动过期清理

---

**更新**: 2026-04-29