# spec: ws-lab.mjs

> L3-WS — /lab WebSocket server, 推 labEvents 到所有 client

## 数据流
```
labEvents.emit('queue' | 'history' | 'escalate' | 'runner', payload)
  ↓
ws-lab.mjs onXxx listener 收到 → broadcast 给所有 ws client
  ↓
{channel: 'queue' | 'history' | 'escalate' | 'runner', at: Date.now(), ...payload}
```

## 接口签名
```js
attachLabWS(apiServer, httpServer)
  → 创建 noServer=true 的 WSS
  → 调 apiServer.registerWebSocket('/lab/ws', wss) 注册到中央派发器
  → 订阅 4 个 labEvents 通道, 收到 → broadcast
  → httpServer close 时 unsub + wss.close
  → 返回 { wss, clients }
```

## WS 协议
- 路径: `/lab/ws`
- 单向推 (server → client), 客户端不需发消息
- 客户端连上立即收 `{channel:'hello', at, message:'lab ws connected'}` 一条
- 事件到 → `{channel, at: Date.now(), ...payload}`
- 断线: 不补发; 客户端重连后调 /lab/api/* 拉最新

## 中央派发 (L3 升级关键)
- 跟 `/ws` (chat) 和 `/signaling` (WebRTC) 共用 `apiServer.startWSDispatch(httpServer)` 的
  'upgrade' 派发器, 避免多 WSS 抢 upgrade 事件
- 全 noServer 模式, 走 `_wsUpgraders: Map<path, wss>`
- 不认识的 path → socket.destroy() (400 Bad Request)

## 边界条件
- 客户端 send 失败 → silently drop (try/catch)
- 客户端 close/error → 从 clients Set 删除
- labEvents 没人订阅 → silently drop, EventEmitter 默认
- 服务重启 → WS 全断, 客户端 3s 后自动重连 (前端 connectWS 处理)

## 决策记录
- **走中央派发, 不自己监 'upgrade'** — 之前用 simple {server} 模式时 /lab/ws 被
  /ws 的 WSS 抢掉, 拿不到 upgrade 事件. 改成 noServer + registerWebSocket 解决.
- **broadcast 用 JSON.stringify 一次, 复给多个 client** — 比每 client 单独 stringify 快
- **不鉴权** — 跟随 /lab API 同假设 (桥内 trust)
- **不做压缩** — lab 事件量小 (一个 goal 一次 queue event), perMessageDeflate 不值

## 不做
- 鉴权 / token 校验
- ack 确认 (fire-and-forget)
- 客户端发消息处理 (只 server→client)
- 持久化 (bridge 重启 → 错过事件, 客户端 re-fetch API)

## 文件清单
| 文件 | 职责 | 行数 |
|------|------|-----|
| `src/api/ws-lab.mjs` | WSS 实例 + labEvents 订阅 + broadcast | 67 |
