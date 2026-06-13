# spec: lab-dashboard

> lab P3 — /lab web UI + 8 JSON API endpoints (L3-WS: 推替轮询)

## 数据流
```
浏览器 GET /lab → 拿 HTML (vanilla JS, WebSocket 推)
                ↓ WS /lab/ws ← labEvents (queue|history|escalate|runner)
                ↓ 收事件 → re-fetch 当前 tab
                ↓ fetch
                /lab/api/{status|queue|history|failures|escalated|regressions|aggregate|retry-stats}
                ↓ 调模块
                src/lab/{goal-queue,history,aggregator,regression,escalate}.mjs
                ↓ 读
                ~/.openchat/lab/{queue,history,escalated}.jsonl
```

## 接口签名 (8 JSON + 1 HTML + 1 WS)
```
GET /lab                        → HTML 页面 (5 tab + WS 推 + 时间窗口筛选)
WS   /lab/ws                    → 推 labEvents (lab-events.mjs): queue|history|escalate|runner
GET /lab/api/status             → {total, pending, running, done, failed}
GET /lab/api/queue              → {goals: Goal[]}
GET /lab/api/history?sinceMs=X  → {runs: Run[]}
GET /lab/api/failures?sinceMs=X → {failed: Goal[]}
GET /lab/api/escalated?sinceMs=X→ {records, stats}
GET /lab/api/regressions        → {regressions, improvements, message?}
GET /lab/api/aggregate          → {experiments: ExperimentStat[]}
GET /lab/api/retry-stats        → {transientFails, transientSucceeded, transientExhausted, saveRate, perAttempt}
```

`sinceMs` 是相对时间戳: API 收到后算 `Date.now() - sinceMs` 当 since. 不传 = 不过滤.

## WS 推 (L3)
- 路径: `/lab/ws`
- 协议: WS, 单向推 (server → client), 客户端不需发消息
- 客户端连上立即收 `{channel:'hello', at:...}` 一条
- 事件到 → `{channel, at, ...payload}`, 客户端 onmessage → 调 refresh() 重画当前 tab
- 断线: 客户端 3s 后自动重连; 重连不补发, 客户端重画时调 API 拿最新

## HTML 页面结构
- **Top bar**: 5 个 stat (total/pending/running/done/failed) + 时间窗口 dropdown (1h/24h/7d/all) + WS 状态灯 (● live=绿 / ● offline=红)
- **Tabs**: Queue / History / Failures / Escalated / Stats
- **每个 tab**: table, 事件驱动刷新 (不再是 5s 轮询)
- **颜色**: green=ok, red=failed, yellow=transient, orange=config, gray=pending/unknown
- **失败时**: 红色 error 提示, 不刷死

## 边界条件
- 所有 API 都用 try/catch, 错返 500 JSON `{error: msg}`
- 8 个 API 全部 GET, 幂等, 无副作用 (后端是 JSONL, 我们只读不写)
- /lab HTML 不缓存 (no-store) — 改了 JS 立刻见效
- queue 状态为 `running` 用黄色 — 用户知道在跑
- 时间窗口 `0` = 全部, 其它 = 毫秒
- WS 断线期间: 不刷新 (避免拼老数据), 状态灯红

## 决策记录
- **vanilla JS 无框架** — 单页 < 200 行, 不值得引 React/Vue; build step 也不值
- **L3 推替 5s 轮询** — labEvents fire-and-forget, 客户端 re-fetch 而非同步 payload (避免双 source of truth)
- **CSP 显式 allow ws:** — connect-src 'self' ws: 允许同源 WS
- **API 跟 CLI 共享模块** — 调 src/lab/* 的同名函数, 不重写统计逻辑
- **不做交互** — 不能从这里 restart / retry, 走 lab.mjs CLI
- **WS 不鉴权** — 跟随 /lab API 同假设, 桥内 trust 域

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/api/routes/lab-dashboard.mjs` | Express Router (1 HTML + 8 API) | 350 |
| `src/lab/lab-events.mjs` | 事件总线 (L3) | 30 |
| `src/api/ws-lab.mjs` | /lab/ws WebSocket server | 60 |

## 不做
- 交互 (restart goal, retry, delete) — 走 lab.mjs CLI
- 鉴权 (跟 /identity 同样假设: 桥内 trust 域)
- 颜色 / 主题切换 (够用就行, 不做 dark/light toggle)
- 错误堆栈 / log viewer
- 手机适配 (现在桌面浏览器优先)
- WS 持久化 (bridge 重启 → 错过事件, 客户端重连后调 API 拉最新)
