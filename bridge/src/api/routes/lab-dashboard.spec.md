# spec: lab-dashboard

> lab P3 — /lab web UI + 8 JSON API endpoints

## 数据流
```
浏览器 GET /lab → 拿 HTML (vanilla JS, 5s poll)
                ↓ fetch
                /lab/api/{status|queue|history|failures|escalated|regressions|aggregate|retry-stats}
                ↓ 调模块
                src/lab/{goal-queue,history,aggregator,regression,escalate}.mjs
                ↓ 读
                ~/.openchat/lab/{queue,history,escalated}.jsonl
```

## 接口签名 (8 JSON + 1 HTML)
```
GET /lab                        → HTML 页面 (5 tab + 5s poll + 时间窗口筛选)
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

## HTML 页面结构
- **Top bar**: 5 个 stat (total/pending/running/done/failed) + 时间窗口 dropdown (1h/24h/7d/all)
- **Tabs**: Queue / History / Failures / Escalated / Stats
- **每个 tab**: table, 5s 自动刷新
- **颜色**: green=ok, red=failed, yellow=transient, orange=config, gray=pending/unknown
- **失败时**: 红色 error 提示, 不刷死

## 边界条件
- 所有 API 都用 try/catch, 错返 500 JSON `{error: msg}`
- 8 个 API 全部 GET, 幂等, 无副作用 (后端是 JSONL, 我们只读不写)
- /lab HTML 不缓存 (no-store) — 改了 JS 立刻见效
- queue 状态为 `running` 用黄色 — 用户知道在跑
- 时间窗口 `0` = 全部, 其它 = 毫秒

## 决策记录
- **vanilla JS 无框架** — 单页 < 200 行, 不值得引 React/Vue; build step 也不值
- **5s poll 不 WebSocket** — 简单, 增量升级留 L3; 实测 5s 足够, goal 跑几十秒起步
- **CSP 头显式设** — 跟 /qiniu-browser 一致, allow 'unsafe-inline' 给 inline CSS/JS
- **API 跟 CLI 共享模块** — 调 src/lab/* 的同名函数, 不重写统计逻辑
- **retry-stats API 跟 CLI 算的逻辑一致** — 但暂不抽公共函数, P3 spec 锁行为, P4 再 refactor
- **不做交互** — 不能从这里 restart / retry, 走 lab.mjs CLI, 留 P4 (更安全, 避免浏览器误点)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/api/routes/lab-dashboard.mjs` | Express Router (1 HTML + 8 API) | 300 |

## 不做
- WebSocket 推 (留 L3, 跟 phone push 一起)
- 交互 (restart goal, retry, delete) — 留 P4 meta-experiment
- 鉴权 (跟 /identity 同样假设: 桥内 trust 域, L3 加 token 校验)
- 颜色 / 主题切换 (够用就行, 不做 dark/light toggle)
- 错误堆栈 / log viewer — 留 P4
- 手机适配 (现在桌面浏览器优先, L3 phone 端跟 push 一起做)
