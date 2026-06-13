# spec: cron

> lab P5 — 定时拉 runNext, 真正"无人值守" (overnight / weekend runs)

## 数据流
1. `startCron({intervalMs})` → 写 pidfile, 返回 handle
2. setTimeout(cycle, intervalMs) — 第一次等 interval 才跑
3. `cycle()`:
   - 连续 `await runNext()` 直到 no pending (或出错)
   - 每次成功 → log `[cron] cycle #N run M: <goalId> OK|FAIL (Xs)`
   - 队列空 → break, log 总结
4. `setTimeout(cycle, intervalMs)` 排下一轮
5. SIGINT/SIGTERM → `stop()` → 清 pidfile

## 接口签名
```js
import { startCron, stopCron, isCronRunning } from './cron.mjs';

const h = startCron({ intervalMs: 30*60*1000 });
//   { ok: true, pid, intervalMs, stop, getStatus }

// 或带 env
//   OPENCHAT_LAB_CRON_INTERVAL=600000 (ms)

stopCron();  // 给别的进程调, kill 当前 cron
isCronRunning();  // boolean, 检查 pidfile + pid 是否还活
```

## 默认 / env
- `intervalMs` 默认 30 min (1800000 ms)
- `OPENCHAT_LAB_CRON_INTERVAL` (ms) env 覆盖

## 边界条件
- 无 interval 跑空队列 → skip (not error), log 一行 "cycle N done (ran 0 goal(s))"
- runNext throw → catch, log, break out of cycle (不 kill 循环)
- 双开 cron: 第二个 startCron 返回 `{ok:false, reason:'cron already running', pid: <alive_pid>}`, 不写 pidfile
- 死 pidfile (进程已死): startCron 自动清掉再开新的 (pidfile 是 transient)
- 自己 pid = pidfile pid → 算 already running (防 fork 后双开)
- SIGINT/SIGTERM (Linux): handler 调 stop() → 清 pidfile + process.exit(0)
- **Windows SIGINT 不可靠**: cron-stop 双保险 = 发 SIGINT (best effort) + 删 pidfile
  - cron 内部 1s 一次的 setInterval 看 pidfile, 不见了就 stop() → exit
  - 兜底机制, 跨平台都 work
- 跑时 SIGINT: 立即 stop, 不等当前 cycle 完成 (跑 goal 用的子进程 — Node 默认会传给 child)
  - 子进程可能不响应 SIGINT → 用户 ctrl-C 二次强杀即可 (Node 默认)

## 不做 (out of scope)
- cron expression (e.g. "0 2 * * *") — 本期只用固定 interval, 简单
- 并发跑 N 个 — 留 L2
- 跑 cron 时持久化 cycle log 到文件 — stdout 就够 (以后 L4 加 log rotate)
- 日历感知 (工作日 only / 节假日 skip) — over-engineering
- 自动重启 (失败后 backoff) — 简单起见, 直接等下个 interval
- catch-up missed runs — cron 跨停机时段不补跑 (restart 也不会自动 drain backlog)

## 文件清单
| 文件 | 职责 | 行数 |
|------|------|-----|
| `src/lab/cron.mjs` | startCron + stopCron + isCronRunning + pidfile | 130 |

## 验证 (end-to-end)
| 测 | 命令 | 预期 |
|---|---|---|
| pidfile 写 | start 一次, 看 `~/.openchat/lab/cron.pid` | 内容 = process.pid |
| 双开拒绝 | 再 startCron → `{ok:false, reason:'cron already running'}` | 第二次不写新 pidfile |
| 死 pidfile 清 | 删 cron 进程 (kill), 不删 pidfile, 再 start → 自动清 pidfile 再开 | 通了 |
| 跑一轮 | intervalMs=1000, add 1 个 goal, 等 ~2s → 日志看到 "cycle #1 run 1" | 跑完了 |
| 队列空 | 不 add goal, 等 ~2s → 日志看到 "cycle #1 done (ran 0 goal(s))" | 没报错 |
| stop cron | SIGINT (or `lab.mjs cron-stop`) → pidfile 删除, `cron-status` 返回 not running | 清掉了 |
| 短 interval | intervalMs=500, add 3 goal → cycle 内连续跑 3 次, 队列空 → 等下个 cycle | 串行 |

## CLI 表面
```
node bin/lab.mjs run-cron [intervalMs]    # 启 cron (默认 30 min)
node bin/lab.mjs cron-status              # 看 cron 是否在跑 + 状态
node bin/lab.mjs cron-stop                # 给 cron 进程发 SIGINT
```