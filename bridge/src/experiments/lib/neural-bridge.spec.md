# spec: neural-bridge

> 22.mjs (tool-loop) 接 NeuralBrain 的 opt-in 接入层 (Step 4 / L2 局部)

## 数据流
1. 22.mjs 启动 → 调 `init()` (内部读 env `OPENCHAT_NEURAL_BRAIN=1`)
2. processText 入口 → 调 `predict(text)` → 返回 `{difficulty, domain, canLocal, samples}` 或 null (未启用)
3. 22.mjs 拿预测 → 调 `adaptTools(callerTools, domain)` + `adaptMaxRounds(20, difficulty)` 改 runtime
4. 22.mjs loop 跑完 → 调 `trainOnOutcome({text, predicted, success, error})` → brain 自训

## 接口签名
```js
init({ enabled?: bool }): NeuralBrain       // 默认从 env 读
setEnabled(on: bool): void                  // 测试 / runtime 切换
isEnabled(): bool
predict(text: string): { difficulty: 0-3, domain: string, canLocal: bool, samples: number } | null
adaptTools(tools: Tool[], domain: string): Tool[]   // code_review → 只读
adaptMaxRounds(base: number, difficulty: 0-3): number
trainOnOutcome({ text, predicted, success, error }): { accuracy, samples, epochs } | null
getStats(): { architecture, samples, epochs, accuracy, weights } | null
```

## 边界条件
- `OPENCHAT_NEURAL_BRAIN` 未设 / != '1' → `_enabled = false`, 所有 API 早返原值
- `predict` 传 null/undefined → 返回 null
- `adaptMaxRounds` 传非 0-3 数字 → 返原 base
- `trainOnOutcome` 失败时 difficulty 自动 +1 (上限 3), domain → 'logic'
- 多次调 `init()` → 返回同一 singleton, 不重建

## 决策记录
- **opt-in** (env) — brain 未训时预测是 noise, always-on 会引入新 bug
- **singleton** — NeuralBrain 8KB 权重, 每 processText new 浪费
- **失败升档** — 简单题失败说明实际更难, 反馈给 brain 下次预测

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `neural-bridge.mjs` | singleton wrapper + 3 API | 100 |
| `22.mjs` (修改) | 3 hook 接入口 | +20 |
| `bin/train-brain.mjs` | 手动 seed + stats | 80 |

## 不做
- `canLocal` 短路 LLM (需"本地解"能力, 暂无数据)
- 改 systemPrompt (fragile, 留 L2 整)
- 多 brain 实例 (over-engineering)
- 训练数据自动从历史 /goal 挖 (留 Step 5)
