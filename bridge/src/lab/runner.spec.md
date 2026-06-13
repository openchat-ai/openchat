# spec: runner

> lab P0 + P1 + P2 — 拉下一个 pending goal, 跳 openchat --goal, 写 result + auto-retry + escalate

## 数据流
1. `runNext()` → `getNextPending()` 拿 goal
2. `updateGoal(id, {status: 'running', startedAt})` 标 running
3. spawn `node bin/openchat.mjs --goal <desc>` (子进程, cwd=process.cwd(), stdio='inherit')
4. 子进程 exit / error → 调 `classify({exitCode, signal, error?})` 拿 classification
5. `_finalize(goal, result, classification, attempt, finishedAt)`:
   - **transient + retry < MAX_RETRIES** → 重置 pending, retryCount++ (auto-retry)
   - **success** → done
   - **其它 (code/config/unknown) 或 retry 上限** → failed + escalate
6. `recordRun({...classification, retryAttempt})` 写 history.jsonl
7. resolve `{ok: true, goal, result, classification}`
8. `runAll(maxRuns=100)` → 串行 runNext, 遇到 no pending 就停
   (transient goal 会回来再 pick, 正常; 不会死循环, 因为 retryCount 有限)

## 接口签名
```js
runNext(): Promise<{ ok: true, goal, result, classification } | { ok: false, reason, goal?, error?, classification? }>
runAll(maxRuns?: number): Promise<Array<{ ok, goal, result?, classification? }>>
```

## 边界条件
- 无 pending goal → `{ok: false, reason: 'no pending goal'}`, 不报错
- 子进程 exit code 0 → success → done
- 子进程被 SIGTERM/SIGKILL 杀 → transient → auto-retry (重置 pending)
- 子进程 exit code 非 0 → code → failed + escalate
- 子进程 spawn error (e.g. ENOENT) → config → failed + escalate
- `startedAt` 用局部变量 (不是 goal.startedAt, 那是 pre-update)
- `runAll(maxRuns)` 默认 100, 防止死循环
- MAX_RETRIES = 2, 即: 1 次初始 + 最多 2 次 retry = 3 次尝试
- 第 3 次仍 transient → failed + escalate (因为 retryCount 已到 MAX)

## 决策记录
- **stdio: 'inherit'** — 用户能看见 /goal 全部输出, 跟手动跑一样
- **不并发** — 单 goal 串行, lab 假设单用户
- **openchat.mjs --goal** — 子进程走 provider-kit 直连 LLM, 不占桥端口
- **auto-retry 只对 transient** — code/config/escalate 都不重试, 避免浪费 (code 是真 bug, config 是环境问题)
- **escalate 是 fire-and-forget** — 写 log 不等返回, 不阻塞主流程
- **escalatedAt 写 queue** — P2: 跟 classification / retryCount 一起, 都是 goal 的状态

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/runner.mjs` | runNext + runAll + _finalize (auto-retry + escalate) | 130 |
| `src/lab/failure-analyzer.mjs` | classify (新) | 50 |
| `src/lab/escalate.mjs` | escalated log (新) | 50 |
| `bin/openchat.mjs` (现有) | --goal 模式 | (不动) |

## 不做
- 并发跑 N 个 (留 L2 跟 phone 编排)
- 输出捕获到 log 文件 (留 P3 跟 /lab dashboard 一起)
- stderr 文本分析 (e.g. 抓 "rate limit") — 留 P3
- 失败 experiment 自动隔离 (e.g. code 失败就停跑同类) — 留 P2 续
