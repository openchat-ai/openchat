# spec: agent-hooks

> LLM tool-loop 的 pre/post hook 注册表 (Step 6.1 / L3 整车基础)

## 数据流
1. 注册方: `on('preTool', 'permission', async (tool, args) => { ... })`
2. 22.mjs `_execTool`:
   - `await runPre(tool, args)` — 抛 throw 中止 (permission 拒绝)
   - 实际执行 tool
   - `result = await runPost(tool, args, result)` — chain, throw 不抛 (仅 warn)
3. 注销: `off('preTool', 'permission')` 或用 `on()` 返回的 unsubscribe fn

## 接口签名
```js
on(event: 'preTool'|'postTool', name: string, fn: async (tool, args, [result]) => void|string): () => void
off(event, name): boolean
clear(event?): void
runPre(tool, args): Promise<void>  // throw on first failing hook
runPost(tool, args, result): Promise<string>  // chain, errors → warn
listHooks(): { preTool: string[], postTool: string[] }
getStats(): { preTool: number, postTool: number }
```

## 边界条件
- event 不在 {preTool, postTool} → throw
- fn 非 function → throw
- preTool hook 抛 throw → 中止链, e.hookName 标记 hook 名
- postTool hook 抛 throw → 不抛, console.warn
- 多次 on 同 name → 后注册覆盖前
- 默认 (无 hook) → 行为 0 变化

## 决策记录
- **preTool throw 中止, postTool warn** — pre 是"拦截", post 是"清理/日志", 语义不同
- **postTool chain** — 一个 hook 的 result 喂下一个, 支持 transform pipeline
- **on() 返回 unsubscribe** — 函数式风格, 避免漏 off

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lib/agent-hooks.mjs` | 注册表 + run/clear API | 80 |
| `lib/agent-hooks.spec.md` | 本 spec | 60 |
| `22.mjs` (修改) | _execTool 调 runPre/runPost | +10 |
