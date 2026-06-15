# spec: supervisor
> 监督循环，检测 running goal 异常状态（卡死/死循环/超长），干涉救活。

## 数据流
每 30s 扫描 active-runs → 检测异常 → _intervene() → 发 SIGINT/SIGTERM → 诊断 last output → goal reset pending + hint

## 接口签名
- `startSupervisor(opts)` → `{ stop(), getStatus() }`

## 检测维度
- stuck: lastOutputAt > 120s 无输出
- loop: 同一行 log 重复 >5 次
- overlong: duration > 3x median

## 边界条件
- 同 goal 60s 冷却期内不重复干涉
- 干涉时先 SIGINT，5s 无响应再 SIGTERM
- turbo 模式用 cancel Promise race
- 干涉后记 failed 再重置 pending（避免 supervisor 重复扫描）

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lab/supervisor.mjs` | 监督循环 | 150 |
