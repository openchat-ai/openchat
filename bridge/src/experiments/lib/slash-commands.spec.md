# spec: slash-commands

> dev-repl 的斜杠命令分发 (opencode/claudecode 风格)

## 数据流
1. 用户在 readline 输入 `/...`
2. dev-repl 调 `parseSlash(input)` → `{ handled, cmd, arg }`
3. 若 handled, 调 `applySlash({cmd, arg, ctx})` → `{ reply, sideEffect? }`
4. dev-repl 打印 reply, 应用 sideEffect (setModel / clearHistory / exit)

## 接口签名
```js
COMMANDS: { [name]: { arg, desc, permission? } }  // 注册表 (name = 命令名, 去掉前导 /)
  arg:        string                                // 用法占位符, 喂给 /help
  desc:       string                                // 一行说明
  permission: 'self' | 'git'                        // 运行时权限闸 (默认 'self')
listCommands():       string                        // 人类可读列表 (供 /help)
listCommandNames():   string[]                      // 仅命令名 (供 readline completer)
validateCommandName(s): { ok, cmd?, suggestion? }   // 拼写校验 (供 autocomplete)
parseSlash(input: string): { handled, cmd?, arg?, reply? }
applySlash({ cmd, arg, ctx }): Promise<{ reply?, sideEffect? }>
  ctx: { cfg, providerName, model, sessionId, cwd, toolCount, historyRounds, availableSessions?, onCommit? }

sideEffect: { setModel?: string, clearHistory?: bool, resumeTo?: string, exit?: bool }
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
- ✅ /help /status /clear /history-clear /model /resume /forget /diff /commit /task /workflow /exit /quit
- ❌ /sessions /compact /cost /bug /init /memory — 需新 storage 模块, 另开 PR

## /history-clear (Step 4 元数据约定)
- 注册名: `history-clear` (key 需引号因含连字符)
- arg: `''` — 不接受参数 (有参 → 走 parseSlash 的"未知命令"分支? 不, 走 arg 丢弃)
- desc: `清空当前 session 的对话历史 (不退出, 不清屏)`
- permission: `'self'` — 仅影响当前 session, 无外部资源访问
- 与 /clear 的区别: /clear 包含 ANSI 清屏码 + 历史重置; /history-clear 只清历史, 保留屏幕
- 在 COMMANDS 注册表中按"基础命令 → 状态 → 历史管理 → 模型/会话 → git → 高级 → 退出"顺序排列

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/src/experiments/lib/slash-commands.mjs` | 解析 + 应用 (async) | 200 |
| `bridge/src/experiments/lib/dev-repl.mjs` | readline 顶部 dispatch + 注入 availableSessions/onCommit | (改 1 处) |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `/help` | 列出 8 个命令 |
| C2 | `/status` | 输出 session/provider/cwd/tools/history |
| C3 | `/model X` | "已切换 model: X" |
| C4 | `/unknown` | "未知命令" |
| C5 | `/exit` | 退出 |
| C6 | `/resume` | 列 ≤20 session + 当前 |
| C7 | `/resume <id>` | 灌入历史 |
| C8 | `/commit` (有变更) | "✓ 已 commit: msg" |
| C9 | `/commit` (无变更) | "✗ 无未提交的变更" |
| C10 | `/commit` (无 git 仓库) | "✗ 当前目录不是 git 仓库" |
| C11 | `/history-clear` 元数据 | `COMMANDS['history-clear']` 存在, arg='', desc 含"不退出, 不清屏", permission='self' |
| C12 | `listCommandNames()` | 含 `'history-clear'`, 数量 ≥ 13 |
| C13 | `validateCommandName('history-clear')` | `{ok:true, cmd:'history-clear'}` |
| C14 | `validateCommandName('history-cle')` | `{ok:false, suggestion:'/history-clear'}` (Levenshtein=2) |
| C15 | `validateCommandName('xyz')` | `{ok:false, suggestion:null}` (无近邻) |

## 不变量
- COMMANDS 是单例, 不在运行时变更
- parseSlash 纯函数, 无副作用
- applySlash 不直接操作 readline / process.exit, 全部通过 sideEffect 通知 caller
- 不持久化 model 切换 (运行中内存态, 退出生效)
