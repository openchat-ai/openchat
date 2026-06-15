# spec: active-runs
> 正在运行的目标注册表，供 supervisor 监控 + runner 注册/反注册。

## 数据流
runner/spawn → registerRun() → ... 运行中 ... → appendOutput() → supervisor 读取 → unregisterRun()

## 接口签名
- `registerRun(goalId, opts)` → RunRecord
- `unregisterRun(goalId)` : void
- `getActiveRuns()` → RunRecord[]
- `getRun(goalId)` → RunRecord | undefined
- `appendOutput(goalId, text)` : void
- `getTail(goalId, n)` → string[]

## 边界条件
- 同 goalId 重复 register → 覆盖旧条目
- logLines 上限 100，溢出裁头
- appendOutput 对空行跳过
- 所有操作不抛

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lab/active-runs.mjs` | 注册表 | 60 |
