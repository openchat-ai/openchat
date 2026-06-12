# spec: neural-bridge

> 22.mjs (tool-loop) 接 NeuralBrain 的接入层 (Step 4 / L2 局部, always-on)

## 数据流
1. 22.mjs 启动 → 调 `init()` (默认 enabled=true, 启动即训/推)
2. processText 入口 → 调 `predict(text)` → 返回 `{difficulty, domain, canLocal, samples}`
3. 22.mjs 拿预测 → 调 `adaptTools(callerTools, domain)` + `adaptMaxRounds(20, difficulty)` 改 runtime
4. 22.mjs loop 跑完 → 调 `trainOnOutcome({text, predicted, success, error})` → brain 自训

## 接口签名
```js
init({ enabled?: bool }): NeuralBrain       // 默认 true (always-on)
setEnabled(on: bool): void                  // 测试 / runtime 切换
isEnabled(): bool
predict(text: string): { difficulty: 0-3, domain: string, canLocal: bool, samples: number } | null
adaptTools(tools: Tool[], domain: string): Tool[]   // code_review → 只读
adaptMaxRounds(base: number, difficulty: 0-3): number
trainOnOutcome({ text, predicted, success, error }): { accuracy, samples, epochs } | null
getStats(): { architecture, samples, epochs, accuracy, weights } | null
```

## 边界条件
- **always-on** — `init()` 默认 enabled=true, 无 env flag. brain 未训时预测是 noise, 22.mjs 已容错
- `setEnabled(false)` 关掉后 API 早返原值
- `predict` 传 null/undefined → 返回 null
- `adaptMaxRounds` 传非 0-3 数字 → 返原 base
- `trainOnOutcome` 失败时 difficulty 自动 +1 (上限 3), domain → 'logic'
- 多次调 `init()` → 返回同一 singleton, 不重建

## 决策记录
- **always-on** — brain 是 L2 局部能力, 跑得越多越准. opt-in 阶段已过 (2026-06-13), 复杂度不值
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
