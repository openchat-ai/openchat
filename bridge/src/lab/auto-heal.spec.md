# spec: auto-heal
> 诊断失败的 goal 并建议修复方案。

## 数据流
failed goal → diagnose() → 匹配 PATTERNS 模式 → 返回 diagnosis

## 接口签名
- `diagnose(result)`: → { ok, diagnosis: { pattern, severity, suggestion, confidence }? }
- `healGoal(goalId)`: → { ok, goal, diagnosis }

## 边界条件
- result.ok=true → 跳过诊断
- goal 不存在或未失败 → healGoal 返回 error
- 未知错误模式 → pattern=unknown, severity=manual, confidence=low
- 所有 diagnose 调用不抛异常

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/auto-heal.mjs` | 诊断引擎 | 80 |
| `src/lab/auto-heal.spec.md` | 本文件 | - |
