# spec: subagent

> dev-repl 的子 agent 调度，复用主 provider/工具链，独立 sessionId 隔离历史。

## 数据流
1. dev-repl 收到 `/task <goal>` 斜杠命令
2. 注入 `ctx.onTask(goal)` 回调
3. dev-repl 调 `runSubagent({ goal, deps, opts })`
4. subagent 跑独立 chat 循环（最多 30 轮）
5. 收尾：截断到 4000 字符 + 返回 `{ ok, finalAnswer, durationMs, rounds, toolCalls, usedFallback }`
6. dev-repl 收到结果后把 `finalAnswer` 注入当前 messages 当 system 消息，触发主 LLM 整合

## 接口签名
```js
runSubagent({ goal: string, deps: { provider, providerLabel, MODEL, cfg, fallbacks, pickFirstAlive, loadTools }, opts?: { maxRounds?: number } })
  → Promise<{ ok: boolean, sessionId: string, finalAnswer: string, durationMs: number, rounds: number, toolCalls: number, usedFallback: boolean, error?: string }>
```

## 边界条件
- goal 为空 / 非字符串 → 返 `{ ok:false, error:'goal 必须是非空字符串' }`
- deps 缺关键字段（provider/loadTools）→ 返 `{ ok:false, error:'deps 缺失' }`
- 工具加载 0 个 → 返 `{ ok:false, error:'工具加载失败' }`
- 30 轮未达 finalAnswer → 强制 stop prompt 收尾，仍无 → `[subagent 无输出]`
- provider 失败 → 试 fallback；全部失败 → 返 `{ ok:false }`
- finalAnswer > 4000 字符 → 截断 + 加省略说明
- 工具错误（EACCES/ENOENT/timeout）→ 写入 messages 当 tool result，不中断循环
- 不持久化子任务历史到 `repl-history`（throw-away）
- 不复用主 session 的 toolCache（独立 Map）

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|----------|
| `lib/subagent.mjs` | subagent 核心循环 | 220 |
| `lib/subagent.spec.md` | 本 spec | - |
| `lib/slash-commands.mjs` | +`/task` 命令定义 + apply 分支 | +30 |
| `lib/dev-repl.mjs` | +注入 onTask 回调 + 处理 task sideEffect | +20 |
| `tests/integration/dev-repl-smoke.mjs` | +subagent 契约 + /task 注入 | +60 |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|------------|------|
| C1 | `[subagent]` | 启动 + 收尾日志 (dev-repl 注入时打) |
| C2 | `sessionId=subagent_` | 独立 session 前缀 |
| C3 | `rounds=`, `toolCalls=` | 摘要中可见 |
| C4 | `usedFallback: true` | fallback 路径触发时打 |

## 不变量（// === invariants ===）
- runSubagent 入口必须接收 deps，不自己再读 cfg
- sessionId 独立于调用方
- 历史轮数 ≤ 30
- 子任务不写盘
- 失败/超时统一返 `{ ok:false }` 不抛
- finalAnswer ≤ 4000 字符
- toolCache 独立
