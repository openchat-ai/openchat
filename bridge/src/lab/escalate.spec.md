# spec: escalate

> lab P2 — 失败目标写 escalated log, L3 起 fire-and-forget 调 notifier

## 数据流
1. runner.mjs 在 done/failed 后, 调 `escalate(goal, classification, attempts)`
2. append 一行到 `~/.openchat/lab/escalated.jsonl`
3. 跟 history 一样 append-only, 不可变
4. fire-and-forget 调 notifier.notify (L3, opt-in, 不配 env = 静默)
5. `lab.mjs escalated` 命令读出来给人看

## 接口签名
```js
escalate(goal: Goal, classification: Classification, attempts: number): Escalation
listEscalated(): Escalation[]
getEscalationStats(): { total, byCategory, byDescription }

Escalation = {
  goalId: string,
  description: string,
  classification: { category, reason, retryable },
  attempts: number,
  escalatedAt: number,
}
```

## 触发条件 (在 runner.mjs)
- `classification.category === 'code'` (exit 非 0, 真 bug)
- `classification.category === 'config'` (spawn 错, 二进制问题)
- `classification.category === 'unknown'` (异常)
- `classification.category === 'transient'` 但 `retryCount >= MAX_RETRIES` (重试也救不回来)

**不触发**: success (exit 0), transient 且 retry 没满 (自动重试中, 还没到 escalate 时机)

## 边界条件
- escalate 是 fire-and-forget — caller 不需要等返回
- 同一 goal 可能被 escalate 多次 (e.g. 重试到第 3 次时) — 当前不防, 后续 P3 加 "已 escalated 跳过"
- classification 缺失 → listEscalated 仍能读, 但 byCategory 显示 'unknown'

## 决策记录
- **跟 history 分开两个文件** — history 是所有 run (包括成功的), escalated 只是"需要 user 关注"的
- **attempts 字段** — 知道这 goal 实际跑了几次, 1 = 一次就挂, 3 = 重试到上限仍挂
- **L3 接 notifier** — 写完 log 后 fire-and-forget, 配 OPENCHAT_LAB_NOTIFY 才真发, 不配 noop
- **goal-queue 状态不变** — 还是 done/failed, 不加新状态; escalated 状态从 escalated.jsonl 反查

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/escalate.mjs` | escalate + listEscalated + getEscalationStats + notify hook | 60 |
| `src/lab/notifier.mjs` | server|webhook 推送 (L3 拆出) | 100 |

## 不做
- 自动修复 (e.g. exit 1 失败 → 自动改代码再跑) — 太危险
- 限流 (同一 goal 一天只 escalate 一次) — 留 P3+
- 邮件通知 — 留 L4
- 通知历史单独存 — 复用 escalated.jsonl
