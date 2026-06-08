# spec: 40-guardrails-pipeline
> 测 Forge 式 guardrails pipeline 在真实多轮工具调用中的效果。
> 核心问题：加入参数校验 + 错误追踪 + 步骤强制执行后，任务完成率提升多少？总 token 消耗是增是减？

## 假设

- H0（零假设）：guardrails 不改变完成率，只是增加 token 开销
- H1（备择假设）：guardrails 通过减少无效轮次，提高完成率并节省总 token

证伪条件：跑完 4 个场景各 5 次后，如果 treatment 的完成率 ≤ baseline 且 总 token 更多 → 放弃该方向。

## 数据流

```
输入场景描述 (text)
  ↓
[baseline 分支]                    [treatment 分支]
  LLM → exec (raw)                  LLM → ResponseValidator(校验全部调用)
  ↓                                    → 通过? → StepEnforcer(检查前提)
  repeat till done/max                   → 通过? → exec (经 tool-rescue)
  ↓                                    → 失败? → ErrorTracker(记录)
  ↓                                             → retry with nudge
  ↓                                    repeat till done/max
  ↓
比较: { 完成率, 轮次, 无效调用, 估计 token }
```

## 接口签名

```js
// 主入口
run({ inputs: {
  op: 'compare' | 'run_pipeline' | 'run_baseline',
  scenario: string,        // 场景描述
  live: boolean,           // true=真实LLM, false=模拟
  repeats: number,         // 每场景重复次数
  providerKit?: object,    // 真实LLM用的provider
  model?: string,
}})
→ { outputs: {
  // compare mode
  baseline: Metrics,
  treatment: Metrics,
  delta: { completionRate, avgRounds, avgToken, invalidCalls },
  verdict: 'H0' | 'H1',

  // run_pipeline / run_baseline mode
  rounds: number,
  completed: boolean,
  invalidCalls: number,
  tokenEstimate: number,
  history: array,
}}

// 内部
ResponseValidator(response, schemas) → { valid, errors[], toolCalls[] }
StepEnforcer(step, state) → { ok, missing[] }
ErrorTracker() → { record(name, error), shouldRetry(name, attempt), getHistory() }
estimateTokens(str) → number
```

## 边界条件

- 空输入 → throw
- live=false 时用 mock LLM 输出（硬编码的正确/错误调用序列），不依赖网络
- live=true 时跳过 scenarios 3-4（需要真实错误恢复）
- MAX_ROUNDS=8, MAX_REPEAT=3 与 skeleton-agent 一致
- 重复超过 MAX_REPEAT 的调用不计入无效，直接中止
- 场景失败不计入「无效调用」，只影响「完成率」

## 场景设计（4 个）

| # | 场景 | 所需工具 | 预期困难 | 基线预期 | 干预预期 |
|---|------|---------|---------|---------|---------|
| 1 | 读 package.json 的 name 字段 | read_file(1步) | 无 | 100% | 100% |
| 2 | 搜索含 "class" 的文件，读内容，重命名类 | glob + read_file + edit_file (3步) | 步骤顺序 | 部分完成 | 高完成 |
| 3 | 读不存在的文件，排查 | read_file(失败) + glob | 错误恢复 | 放弃 | 有引导重试 |
| 4 | 优化项目配置（模糊目标） | 多步推理 | 目标分解 | 乱调 | 有序执行 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `40-guardrails-pipeline.mjs` | 实验主文件：pipeline + 比较逻辑 | 250 |
| `lib/response-validator.mjs` | 响应级工具调用校验 | 80 |
| `lib/step-enforcer.mjs` | 步骤前提检查 | 80 |
| `lib/error-tracker.mjs` | 错误追踪 + 重试决策 | 80 |

## 调试检查点

| C | grep 关键词 | 预期 |
|---|------------|------|
| C1 | `[GP] validate response` | 每次 LLM 响应后触发校验 |
| C2 | `[GP] validation failed` | 校验失败时打印具体错误 |
| C3 | `[GP] step enforce` | 每次 exec 前检查前提 |
| C4 | `[GP] missing precondition` | 前提缺失时打印 |
| C5 | `[GP] error track` | 工具调用失败时记录 |
| C6 | `[GP] retry with nudge` | 触发带引导重试 |
| C7 | `[GP] compare result` | 比较结果输出 |
| C8 | `[GP] verdict` | 判断 H0/H1 |

## 不变量

- `MAX_ROUNDS` 和 `MAX_REPEAT` 与 skeleton-agent 一致
- 同一 call 的错误最多重试 `MAX_RETRIES=3` 次
- ErrorTracker 跨轮次保持状态，但每场景开始时 reset
- StepEnforcer 只检查 registered 前提，不阻止未被描述的前提
- response-validator 只校验 tool_calls 数组，不修改 content
