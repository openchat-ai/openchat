# 语音数据流与协议文档

## 架构总览

```
┌──────────────┐     TCP :3801      ┌──────────────┐
│  手机 A       │ ──── 信令/音频 ──→ │  OpenChat    │
│  VoiceClient  │ ←──────────────── │  Bridge      │
│              │                    │  (信令中继)   │
│  UDP 直连 ◀──┼── 打洞成功后 ────→ │              │
│              │   音频走 UDP       │              │
│  Qiniu 回退  │ ←── TCP 不通时 ──→ │  七牛云中继   │
└──────────────┘                    └──────────────┘
```

语音路径优先级：**UDP 直连 > TCP 信令 > Qiniu 文件回退**

---

## 1. RFID 风格帧协议

所有 Bridge 与手机之间的通信使用二进制帧，定义在 `voice_frame.dart` 和 Bridge `src/core/audio/` 中。

### 帧格式

```
BB | TYPE(1) | CMD(1) | PL(2) | PARAM(N) | CKSUM(1) | 7E
```

| 字段 | 长度 | 说明 |
|------|------|------|
| BB | 1B | 帧起始标记 `0xBB` |
| TYPE | 1B | `0x00`=请求, `0x01`=响应, `0x02`=通知 |
| CMD | 1B | 命令码（见下方） |
| PL | 2B | PARAM 长度（大端） |
| PARAM | N B | 负载数据（UTF-8 JSON 或 PCM） |
| CKSUM | 1B | TYPE+CMD+PL+PARAM 求和 & 0xFF |
| 7E | 1B | 帧结束标记 `0x7E` |

### 7E 逃逸

PARAM 中出现 `0x7E` 或 `0x7D` 时需要逃逸：
- `0x7E` → `0x7D 0x5E`
- `0x7D` → `0x7D 0x5D`

### 命令码

| CMD | 方向 | 说明 |
|-----|------|------|
| `0x01` audio | 双向 | PCM 音频数据帧 |
| `0x02` signal | 双向 | 信令（call-request/accept/reject） |
| `0x03` ack | 双向 | 确认帧，含 seq 号 |
| `0x04` route | Bridge→手机 | 路由信息更新 |
| `0x06` heartbeat | 双向 | 心跳保活 |
| `0xFF` error | 响应 | 错误码 |

### 实现

- Flutter: `openchat-flutter/lib/core/api/voice_frame.dart`
- Bridge: `bridge/src/core/audio/` 目录

---

## 2. VoiceClient 通话流程

文件: `openchat-flutter/lib/core/api/voice_client.dart`

### 状态机

```
idle → calling → ringing → connected → idle
                        ↘ ended → idle
```

### 呼叫流程

```
发起方                          接收方
  │                              │
  ├─ connect(host, port) ───────→│ 建立 TCP 连接
  │  (注册 peerId)               │
  │                              │
  ├─ call(targetPeerId) ────────→│ 发送 call-request
  │  ├── UDP hole punch  ───────→│ 并行尝试 UDP
  │  └── 等待 punch 结果         │
  │                              │
  │                         ←─── ┤ 进入 ringing 状态
  │                              │ (需用户接听)
  │                         ←─── ┤ acceptCall() → connected
  │                              │
  ├── connected ────────────────→┤ 双方开始音频流
  │  _startAudio()               │
  │  └── Recorder → _onAudioData │
  │      └── 编码 → 发送        │
  │                              │
  │  ←── 接收 → _onTcpData       │
  │           或 _onUdpData      │
  │              └→ _processReceived → AudioPlayer.play()
```

### 自适应帧大小

音频帧大小根据网络质量自动调整（10ms-60ms）：

| RTT | 重传率 | 帧大小 | 场景 |
|-----|--------|--------|------|
| <100ms | <2/10帧 | 60ms | 高质量 |
| <300ms | <5/10帧 | 20ms | 正常 |
| ≥300ms | ≥5/10帧 | 10ms | 差网络 |

### 重传机制

- 每帧带递增 seq 号
- 500ms 定时器检查未确认帧
- 超时 1s 或重试 ≥3 次则丢弃
- 总生存期 5s

---

## 3. UDP 打洞

类: `UdpHolePunch`（voice_client.dart 末尾）

### 流程

```
手机 A                          Bridge                      手机 B
  │                               │                           │
  ├─ POST /api/v1/signaling/udp-punch ──→                    │
  │   { myPeerId, targetPeerId, myPort }                     │
  │                               │                           │
  │                          ←──── 返回 targetIp:targetPort ─→│  交换地址
  │                               │                           │
  ├── RawDatagramSocket.bind()    │                           │
  ├── send(ping, targetIp, port) ─┼──────────────────────────→│
  │                               │                           │
  │                          ←─── send(ping, myIp, myPort) ───┤
  │  (防火墙打洞成功)              │                           │
  │                               │                           │
  │                          ╔═══════════════════════╗        │
  │                          ║  后续音频走 UDP 直连   ║        │
  │                          ╚═══════════════════════╝        │
```

### 失败降级

UDP 打洞失败（500ms 无响应）→ `_useUdp = false` → 音频走 TCP 信令。

---

## 4. Qiniu 中继回退

Bridge 端: `bridge/src/core/bucket-relay.js`

当 TCP 和 UDP 都不可达时（如对称 NAT），通过七牛云对象存储中转：

```
手机 A → 写音频到 Qiniu → 通知 Bridge → Bridge 通知手机 B → 手机 B 从 Qiniu 读
```

- 自动选择延迟最低的 bucket（多区域就近读写）
- 使用 bucket-relay.js 管理多 bucket 延迟探测
- 每条音频记录由 `roomId + seq` 唯一标识

---

## 5. 路由层（多跳）

Flutter: `openchat-flutter/lib/core/api/voice_router.dart`

当直接 P2P 连接不可用时，通过中间节点转发：

- 每个手机维护路由表（`targetPeerId → nextHopPeerId`）
- 通过 gossip 协议交换路由信息
- 支持多跳转发（路径列表 `[hop1, hop2, target]`）
- 60s 超时标记老旧路由，3 次失败标记死亡路由

---

## 文件索引

| 文件 | 职责 |
|------|------|
| `openchat-flutter/lib/core/api/voice_client.dart` | 通话客户端：TCP 信令、UDP 打洞、音频收发 |
| `openchat-flutter/lib/core/api/voice_frame.dart` | RFID 帧编码/解码 + Cmd 常量 |
| `openchat-flutter/lib/core/api/voice_router.dart` | 多跳路由 + gossip |
| `bridge/src/api/server.js` | Bridge TCP 信令服务器（:3801） |
| `bridge/src/core/bucket-relay.js` | Qiniu 多 bucket 延迟探测 + 读写 |
| `bridge/src/api/routes/signaling.js` | UDP 打洞 REST 端点 |
