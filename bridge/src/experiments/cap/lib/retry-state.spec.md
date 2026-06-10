// lib/retry-state.spec.md
# spec: retry-state

> 状态机下沉假说验证 — LLM 只调 recordAttempt，状态机决定 retry/throw

## 数据流
LLM 调 `recordAttempt({ ok, error, kind, delayMs })` → 状态机返回 `{ type, ... }`
type ∈ { done, failed, retry, already_settled }

## 接口签名
```
create({ maxAttempts?: 3, baseDelayMs?: 10 }) → state
state.recordAttempt({ ok, error?, kind?, delayMs? }) → { type, ... }
state.getState() → 'pending'|'running'|'retry'|'failed'|'done'
state.getAttempts() → number
state.getLog() → [{ t, state, attempt, event, ... }]
state.describe() → { state, attempts, maxAttempts, totalMs, lastEvent }
```

## 边界条件
- maxAttempts < 1 → throw at create
- recordAttempt after settled → return { type: 'already_settled' }
- kind=THRESHOLD|FATAL → 立即 failed, 不重试
- 超过 maxAttempts → failed reason='max_attempts'
- 内部禁止 throw, 全部 return

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| lib/retry-state.mjs | 状态机 + 日志 | 100 |
| lib/retry-state.spec.md | 本文件 | 50 |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|------------|------|
| C1 | `recordAttempt` | log 出现 attempt 事件 |
| C2 | `kind=THRESHOLD` | log 出现 failed_no_retry |
| C3 | `attempts >= maxAttempts` | log 出现 failed_max_attempts |
| C4 | `done` | log 出现 done |

## 不变量
见文件顶部 invariants 块
