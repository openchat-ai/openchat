# spec: lab-events.mjs

> L3-WS 事件总线 — fire-and-forget, 单进程 EventEmitter, 推 /lab WebSocket

## 数据流
1. 写 jsonl 的函数 (addGoal / updateGoal / recordRun / escalate) 在 append 完 → emit 事件
2. ws-lab.mjs 订阅事件 → broadcast 给所有 WS client
3. client 收到 → re-fetch 当前 tab 的 API (不强同步 payload, 避免双 source of truth)

## 接口签名
```js
import { labEvents } from './lab-events.mjs';

labEvents.on('queue', (evt) => {...})     // {type: 'added'|'updated', goal}
labEvents.on('history', (evt) => {...})   // {type: 'added', run}
labEvents.on('escalate', (evt) => {...})  // {record}
labEvents.on('runner', (evt) => {...})    // {type: 'start'|'finish', goalId, ...}
```

## 事件清单
| channel | emit 处 | payload |
|---------|---------|---------|
| `queue.added` | goal-queue.addGoal | `{type:'added', goal}` |
| `queue.updated` | goal-queue.updateGoal | `{type:'updated', goal}` |
| `history.added` | history.recordRun | `{type:'added', run}` |
| `escalate` | escalate.escalate | `{record}` |
| `runner.start` | runner.runNext (拉起子进程时) | `{type:'start', goalId, description, startedAt}` |

## 触发
| 写入路径 | 事件 |
|---------|------|
| `lab.mjs add` | queue.added |
| `runner.runNext` (拉起) | queue.updated (status=running) + runner.start |
| `runner.runNext` (exit) | queue.updated (status=done/failed) + history.added [+ escalate] |

## 边界条件
- 单进程 EventEmitter, **不跨进程** (桥是单进程 OK)
- 没有持久化 — bridge 重启 → 错过中间事件, 客户端重连后调 API 拉最新
- setMaxListeners(50): 多个 WS client + 调试 listener 共存
- emit 同步触发 listener, 没人订阅时 silently drop
- ws-lab.mjs 监听 readyState=1 (OPEN) 才 send, 否则 drop

## 不做
- 持久化事件队列 (留 L4)
- 跨进程 / 跨桥事件 (留 L4+)
- 消息确认 ack (fire-and-forget, 客户端不需确认)
- payload 压缩 / 二进制帧 (事件量小, 没必要)

## 文件清单
| 文件 | 职责 | 行数 |
|------|------|-----|
| `src/lab/lab-events.mjs` | 单进程 EventEmitter, lab 内部 fire-and-forget 事件总线 | 28 |
