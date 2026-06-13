# spec: runner

> lab P0 — 拉下一个 pending goal, 跳 openchat --goal, 写 result

## 数据流
1. `runNext()` → `getNextPending()` 拿 goal
2. `updateGoal(id, {status: 'running', startedAt})` 标 running
3. spawn `node bin/openchat.mjs --goal <desc>` (子进程, cwd=process.cwd(), stdio='inherit')
4. 子进程 exit → 标 done/failed + 写 result {ok, exitCode, signal, durationMs}
5. resolve `{ok: true, goal, result}`
6. `runAll(maxRuns=100)` → 串行 runNext, 遇到 no pending 就停

## 接口签名
```js
runNext(): Promise<{ ok: true, goal, result } | { ok: false, reason: 'no pending goal' }>
runAll(maxRuns?: number): Promise<Array<{ ok, goal, result? }>>
```

## 边界条件
- 无 pending goal → `{ok: false, reason: 'no pending goal'}`, 不报错
- 子进程 exit code 0 → done, 其它 → failed
- 子进程被 signal 杀 (e.g. SIGTERM) → failed, signal 字段记录
- 子进程 spawn error (e.g. ENOENT) → failed, error 字段写 err.message
- `startedAt` 用局部变量 (不是 goal.startedAt, 那是 pre-update)
- `runAll(maxRuns)` 默认 100, 防止死循环 (虽然理论上不会, 跑完就没了)

## 决策记录
- **stdio: 'inherit'** — 用户能看见 /goal 全部输出, 跟手动跑一样
- **不并发** — 单 goal 串行, lab 假设单用户, 跑完一个再跑下一个
- **openchat.mjs --goal** — 子进程走 provider-kit 直连 LLM, 不占桥端口, 可以跟运行中的桥并存
- **exit code = 成功标志** — 0 = done, 其它 = failed. /goal 内部 8/8 steps 失败不会改 exit code (那是它自己), 除非顶层 try/catch 抛

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/runner.mjs` | runNext + runAll | 50 |
| `bin/openchat.mjs` (现有) | --goal 模式 | (不动) |

## 不做
- 并发跑 N 个 (留 P2 跟 L2 phone 编排)
- 自动 retry (留 P1 跟 run-all 一起)
- 输出捕获 (留 P3 跟 /lab dashboard 一起, 写 logs/goal-<id>.log)
