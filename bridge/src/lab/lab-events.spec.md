# spec: lab-events.mjs

> L3-WS 事件总线 — fire-and-forget, 单进程 EventEmitter + file watcher (跨进程), 推 /lab WebSocket

## 数据流
1. 进程内: 写 jsonl 的函数 (addGoal / updateGoal / recordRun / escalate) 在 append 完 → emit 事件 (有 payload)
2. 跨进程: lab-events.mjs 启动时 file-watch 3 个 jsonl, 文件变化 → emit `{type:'changed', fromWatcher:true}` (无 payload)
3. ws-lab.mjs 订阅事件 → broadcast 给所有 WS client
4. client 收到 → re-fetch 当前 tab 的 API (不强同步 payload, 避免双 source of truth)

## 接口签名
```js
import { labEvents } from './lab-events.mjs';

labEvents.on('queue', (evt) => {...})     // {type: 'added'|'updated'|'changed', goal?, fromWatcher?}
labEvents.on('history', (evt) => {...})   // {type: 'added'|'changed', run?, fromWatcher?}
labEvents.on('escalate', (evt) => {...})  // {record?, fromWatcher?}
labEvents.on('runner', (evt) => {...})    // {type: 'start'|'finish', goalId, ...}  (只进程内, watcher 不感知)
```

## 事件清单
| channel | emit 处 | payload | 触发场景 |
|---------|---------|---------|---------|
| `queue.added` | goal-queue.addGoal | `{type:'added', goal}` | 进程内 addGoal |
| `queue.updated` | goal-queue.updateGoal | `{type:'updated', goal}` | 进程内 updateGoal |
| `queue.changed` | watcher | `{type:'changed', fromWatcher:true}` | 跨进程 lab.mjs add/run-next 改 queue.jsonl |
| `history.added` | history.recordRun | `{type:'added', run}` | 进程内 recordRun |
| `history.changed` | watcher | `{type:'changed', fromWatcher:true}` | 跨进程改 history.jsonl |
| `escalate` | escalate.escalate | `{record}` | 进程内 escalate |
| `escalate.changed` | watcher | `{type:'changed', fromWatcher:true}` | 跨进程改 escalated.jsonl |
| `runner.start` | runner.runNext | `{type:'start', goalId, description, startedAt}` | runner 拉起子进程 (只在桥进程内有意义) |

## 触发
| 写入路径 | 进程 | 事件 |
|---------|------|------|
| `lab.mjs add` | CLI (新进程) | queue.changed (via watcher) |
| `lab.mjs run-next` 拉起 | CLI (新进程) | queue.changed + 后续 runNext 内部 emit |
| bridge 内 `runner.runNext` 拉起 | 桥进程 | queue.updated + runner.start |
| bridge 内 `runner.runNext` exit | 桥进程 | queue.updated + history.added [+ escalate] |
| `lab.mjs run-next` exit | CLI (新进程) | queue.changed + history.changed [+ escalate.changed] (via watcher) |

## 边界条件
- 进程内 emit: 同步, 立即触发, 有 payload
- watcher emit: 1-2s 延迟, 无 payload (只说"变了"), 客户端 re-fetch
- 同 size 变化: skip (避免 fs.watch 重复 fire 时重复 emit)
- 文件不存在: 50ms 重试 20 次 (1s), 仍没有就放弃 (lab 启动时 jsonl 可能还没建)
- 文件被删/重建: 静默忽略 (FSWatcher 抛错 catch)
- setMaxListeners(50): 多个 WS client + 调试 listener 共存
- 没有持久化 — bridge 重启 → 错过中间事件, 客户端重连后调 API 拉最新

## 不做
- 持久化事件队列 (留 L4)
- 跨桥事件 (留 L4+)
- 消息确认 ack (fire-and-forget, 客户端不需确认)
- payload 压缩 / 二进制帧 (事件量小, 没必要)
- 解析 watcher 触发的文件 (payload 留给 API 端拿, 避免重复解析逻辑)

## 文件清单
| 文件 | 职责 | 行数 |
|------|------|-----|
| `src/lab/lab-events.mjs` | EventEmitter + file watcher (跨进程) | 80 |
