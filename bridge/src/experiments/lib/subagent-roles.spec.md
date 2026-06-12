# spec: subagent-roles

> Step 5 / L2 整 — 把 LLM agent 拆成 3 个 role, 协调器按 step keyword 派发

## 数据流
1. 38.mjs 协调器把 goal 拆成 steps
2. 对每个 step: 调 `pickRole(step.action)` → 返回 'planner' | 'editor' | 'verifier' | (default) 'editor'
3. 38.mjs 调 `composeRun('tool-loop', {text: stepPrompt, chatId, role})`
4. compose.mjs → 22.mjs run() → processText 看 opts.role → 覆盖 prompt + tools + maxRounds
5. step 完成 → 38.mjs 拿 result 喂下一步

## 接口签名
```js
ROLES: { [name]: { name, prompt, tools: string[], maxRounds: number, keywords: string[] } }
  // planner   = 只读 8 rounds
  // editor    = 读+写 20 rounds
  // verifier  = 读+测试 10 rounds
DEFAULT_ROLE: 'editor'
pickRole(stepAction: string): 'planner' | 'editor' | 'verifier'
getRole(name: string): RoleDef
listRoles(): string[]
```

## 边界条件
- stepAction 非 string → DEFAULT_ROLE
- 无 keyword 命中 → DEFAULT_ROLE
- 长 keyword 优先 (e.g. "run tests" 胜过 "run")
- 工具名不在 CODING_TOOLS 中 → 22.mjs filter 后空集, 跟现在一样

## 决策记录
- **3 roles** (而非 2 / 5) — planner/editor/verifier 是 L2 整最常用三角, 加多收益小
- **keyword 派发** (而非 LLM 选) — 减少 1 次 LLM call, 简单可调试, 失败 fallback editor
- **不共享状态** (跨 role) — 38.mjs 协调器传 step.action 文本, 跟 L1.5 agent 行为一致
- **role.tools 跟 MAX_ROUNDS 一起 override** — 跟 Step 4 brain-adapt 同一思路 (config × runtime)

## 不做
- role 间消息总线 (走 step 文本, 够用)
- role 训练数据 (Step 6 L3 再做)
- role 内 reflection / self-critique (留 L2+ 整车)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lib/subagent-roles.mjs` | 3 role 定义 + pickRole 派发 | 80 |
| `lib/subagent-roles.spec.md` | 本 spec | 60 |
| `22.mjs` (修改) | processText 接 opts.role | +20 |
| `38.mjs` (修改) | 协调器派发 role | +5 |
