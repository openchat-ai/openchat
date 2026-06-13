# spec: history

> lab P1 — append-only run log, 跟 queue 状态解耦

## 数据流
1. runner.mjs 在子进程 exit / error 后调 `recordRun({goalId, description, status, exitCode, signal, durationMs, finishedAt, error?})`
2. append 一行到 `~/.openchat/lab/history.jsonl`
3. aggregator / regression 调 `listHistory()` 读全部
4. `backfillFromQueue()` 一次性把 queue.jsonl 里 done/failed 的 import 进来 (P0 → P1 升级用)

## 接口签名
```js
recordRun(run: Run): Run
listHistory(filter?: { since?: number, description?: string }): Run[]
getRunStats(): { total, success, failed, successRate, avgDurationMs }
backfillFromQueue(): { imported: number }
```

`Run` 形状:
```js
{
  goalId: string,
  description: string,
  status: 'done' | 'failed',
  exitCode: number | null,
  signal: string | null,
  durationMs: number | null,
  finishedAt: number,  // Date.now()
  error: string | null,
}
```

## 边界条件
- 文件不存在 = 空 log, 任何读取返 []
- recordRun 假设 caller 已给完整字段, 不做默认值填充 (除了 exitCode/signal/durationMs/error → null)
- listHistory 过滤: `since` (毫秒) 取 finishedAt >= since; `description` 精确匹配
- backfillFromQueue: 已存在的 goalId 跳过 (Set 去重), 只补 done/failed, 不补 pending/running
- 并发写: 假设单用户串行 (跟 queue 一致), 不加锁

## 决策记录
- **append-only** — 历史不变, 跟 queue 全量覆盖分开. 后续要做 dashboard 时间线好做
- **每个 status=done|failed 都写** — 不论成功失败, 失败也是数据
- **不存 description 之外的 context** — experiment 维度的 metadata (e.g. domain) 后续 P2 加
- **backfill 是一次性** — P0 那 2 个 done 当时没 history, 跑一次 lab.mjs backfill 补上, 之后就靠 recordRun 自动写

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/history.mjs` | recordRun / listHistory / getRunStats / backfillFromQueue | 50 |

## 不做
- 压缩 / 归档 (留 P3 dashboard 一起做, e.g. 只保留 90 天)
- 结构化 query (e.g. SQL-like) — 几百行量级不需要, list + filter in JS 够
- 关联到具体 experiment 文件 (`experiments/22.mjs` 之类的) — 留 P2, 跟 auto-retry 一起
