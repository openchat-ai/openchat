# spec: regression

> lab P1 — baseline vs recent 回归检测

## 数据流
1. `detectRegressions()` 调 `listHistory()` 拿全部 run
2. 按 finishedAt 升序, 前 50% = baseline, 后 50% = recent
3. 按 description 分组
4. 对每组 (baseline, recent) 比 3 个维度:
   - success rate 跌 > 20% → regression (success-rate-drop)
   - success rate 涨 > 20% → improvement (success-rate-up)
   - duration > 2x baseline 且 baseline > 1s → regression (duration-doubled)
5. 返 `{regressions, improvements}` 数组

## 接口签名
```js
detectRegressions(): {
  regressions: Regression[],
  improvements: Improvement[],
  message?: string,  // 当 runs < 4 时, 用 message 解释为啥不检测
}

Regression = {
  description: string,
  type: 'success-rate-drop' | 'duration-doubled',
  baselineRuns?: number,
  recentRuns?: number,
  baseline: string,  // e.g. "100%"
  recent: string,    // e.g. "60%"
  mult?: string,     // e.g. "2.3x" (duration-doubled only)
  message: string,
}
```

## 边界条件
- < 4 条 run → 返 `{regressions: [], improvements: [], message: 'need >= 4 runs (have N)'}`
- baseline / recent 里有 description 在另一边不存在 → 跳过 (没法比)
- baseline duration < 1s → 跳过 duration 检测 (小数字抖)
- 一个 description 可触发多条 regression (success + duration 都掉)

## 阈值
- `SUCCESS_RATE_DROP_THRESHOLD = 0.2` (20% 绝对值)
- `DURATION_MULTIPLIER_THRESHOLD = 2.0` (2 倍)
- `MIN_BASELINE_DURATION_MS = 1000` (1s, 避免噪声)
- `MIN_RUNS_FOR_DETECTION = 4`
- `BASELINE_SPLIT = 0.5` (前 50% / 后 50%)

## 决策记录
- **50/50 split** — 简单, 不需要"最近 N 次"窗口; lab 数据量小 (< 100) 不需要时间窗口
- **success rate 跌 + duration 长 各自算** — 两个独立信号, 不合并
- **不区分 hard / soft fail** — 后续 P2 加 failure analyzer 时再细分
- **只比 description 完全相同的** — 跟 aggregator 一致, 不做 normalization
- **MIN_RUNS = 4** — 至少 2 + 2, baseline 跟 recent 各有 1 才能算, 实际给 4 留余量

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/regression.mjs` | 回归检测 | 80 |

## 不做
- 时间窗口 (last 24h / last 7d) — 留 P3 dashboard
- 噪声抑制 (e.g. consecutive failures) — 留 P2 跟 auto-retry
- 自动告警 (发 webhook / phone push) — 留 P3
- 跨 description 影响分析 (改 22.mjs 影响其它 experiment) — 留 P2 meta-experiment
