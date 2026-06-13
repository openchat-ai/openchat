# spec: aggregator

> lab P1 — per-experiment pass/fail 统计 (从 history 算)

## 数据流
1. `getExperimentStats()` 调 `listHistory()` 拿全部 run
2. 按 `description` 分组 (假设相同 description = 同一 experiment)
3. 对每组算: total / success / failed / successRate / avgDurationMs / last5Success / lastRunAt
4. 按 description 字母序排序返

## 接口签名
```js
getExperimentStats(): ExperimentStat[]

ExperimentStat = {
  description: string,
  total: number,
  success: number,
  failed: number,
  successRate: number,  // 0-1
  avgDurationMs: number,
  last5Success: number,  // 最近 5 次里成功次数
  lastRunAt: number | undefined,  // 最近一次 finishedAt (ms)
}
```

## 边界条件
- history 空 → 返 `[]`, 不报错
- 单个 description 1 条记录 → last5Success 是 0 或 1, successRate 是 0 或 1
- last5 用 finishedAt 倒序取前 5
- description 完全相同才合并, 变体 (e.g. "test foo" vs "test foo.") 不合并 (P1 不做 normalization)

## 决策记录
- **按 description 字母序** — 人读起来好找, 不按 pass rate 排 (避免每次跑数据顺序跳)
- **last5 单独算** — 知道 "最近 5 次的表现" 跟 "全部平均" 不同 (老数据可能掩盖回归)
- **不做 normalization** — 假设 user 加 goal 时 description 写得一致; P2 再加 experimentId 字段

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/aggregator.mjs` | per-experiment 统计 | 50 |

## 不做
- 时间窗口过滤 (e.g. last 24h) — 留 P3 dashboard
- 模糊匹配 / 关键词分组 — 留 P2 跟 auto-retry 一起
- 跟 experiments/ 目录联动 (扫 38 个文件自动生成 baseline) — 留 P2
