# spec: cost-tracker

> dev-repl 的 token/cost 累计（opencode `/cost` 简化版）

## 数据流
1. dev-repl 启动时 `new CostTracker(cfg)`
2. 每轮 `provider.chat()` 后调 `recordUsage(messages, responseContent, model, providerName)`
3. 字符→token: `Math.ceil(chars / 4)`（业界粗估，误差 10-20%）
4. cost: 查 `cfg.providers.<name>.costPer1k` 或 `DEFAULT_COST[model]`，找不到 = 0
5. `/status` 输出 `formatSummary()`

## 接口签名
```js
class CostTracker {
  constructor(cfg)
  recordUsage({ messages, responseContent, model, providerName }): { promptTokens, completionTokens, cost }
  summary(): { calls, promptTokens, completionTokens, totalTokens, cost, byModel }
  formatSummary(): string         // 多行 ANSI 友好的 status 输出
  reset()
}
run({ op, cfg?, messages?, responseContent?, model?, providerName?, tracker? })
  // op: 'new' | 'record' | 'summary' | 'format' | 'reset'
```

## 边界条件
- messages 非数组也非字符串 → return `{tokens:0, cost:0}`
- responseContent 非字符串 → completionChars=0
- model 不在 DEFAULT_COST 也没 user override → cost=0（**显式零**，不报错）
- 多 model 调用 → byModel 分别累加
- cfg 缺 providers → 不崩，cost 永远 0
- 负数 chars / 0 chars → token=0

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/src/experiments/lib/cost-tracker.mjs` | tracker 类 + compose 入口 | 200 |
| `bridge/src/experiments/lib/dev-repl.mjs` | 启动时 new, 每轮 record, 注入 costSummary | (改 3 处) |
| `bridge/src/experiments/lib/slash-commands.mjs` | /status 加 costSummary 输出 | (改 1 处) |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `/status` 第一次 | "cost: 暂无记录" |
| C2 | 跑 1 轮对话后 `/status` | "calls: 1 / total: N tokens / cost: $X" |
| C3 | 多 model → byModel 列出 | 多个 model 行 |

## 不变量
- 永不抛
- 字符/token = 4
- 缺 cost 数据 = 0
- summary.byModel 永远有 entry
- formatSummary 不写盘
