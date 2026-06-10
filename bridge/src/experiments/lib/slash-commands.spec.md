# spec: slash-commands

> dev-repl 的斜杠命令分发 (opencode/claudecode 风格)

## 数据流
1. 用户在 readline 输入 `/...`
2. dev-repl 调 `parseSlash(input)` → `{ handled, cmd, arg }`
3. 若 handled, 调 `applySlash({cmd, arg, ctx})` → `{ reply, sideEffect? }`
4. dev-repl 打印 reply, 应用 sideEffect (setModel / clearHistory / exit)

## 接口签名
```js
COMMANDS: { [name]: { arg, desc } }      // 注册表
listCommands(): string                     // 人类可读列表 (供 /help)
parseSlash(input: string): { handled, cmd?, arg?, reply? }
applySlash({ cmd, arg, ctx }): { reply?, sideEffect? }
  ctx: { cfg, providerName, model, sessionId, cwd, toolCount, historyRounds }

sideEffect: { setModel?: string, clearHistory?: bool, exit?: bool }
```

## 边界条件
- 空输入 → parseSlash handled=false (dev-repl 继续走原流程)
- `/unknown` → handled=true, reply="未知命令: /X"
- `/model` 无参数 → reply="用法: /model <name|id>"
- `/model foo` → 改 ctx.model 内存值, **不**改 cfg.current.model (运行中切换语义)
- `/clear` → 打印 ANSI 清屏序列, sideEffect.clearHistory=true
- `/exit` 与 `/quit` 同义, sideEffect.exit=true
- 输入非字符串 → parseSlash handled=false (防御)

## 当前实现 (P0, 故意不做的列在 P2)
- ✅ /help /status /clear /model /exit /quit
- ❌ /sessions /compact /cost /bug /init /memory — 需新 storage 模块, 另开 PR

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/src/experiments/lib/slash-commands.mjs` | 解析 + 应用 | 100 |
| `bridge/src/experiments/lib/dev-repl.mjs` | 在 readline 循环顶部 dispatch | (改 1 处) |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `/help` 输入 | 列出 6 个命令 |
| C2 | `/status` 输入 | 输出 session/provider/cwd/tools/history |
| C3 | `/model X` | 输出 "已切换 model: X" + 下次 LLM 用新 model |
| C4 | `/unknown` | 输出 "未知命令" + 引导 /help |
| C5 | `/exit` | REPL 退出 |

## 不变量
- COMMANDS 是单例, 不在运行时变更
- parseSlash 纯函数, 无副作用
- applySlash 不直接操作 readline / process.exit, 全部通过 sideEffect 通知 caller
- 不持久化 model 切换 (运行中内存态, 退出生效)
