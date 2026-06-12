# spec: permission-gate

> L3 件 1: per-tool permission check + trust 持久化 (Step 6)

## 数据流
1. 22.mjs 在 `_execTool` 调 `checkPermission(toolName, args, ctx)` → { allowed, reason }
2. allowed=true → 跑 tool, result 进 history
3. allowed=false → result = `[Denied: ${reason}]`, LLM 看这个 signal 调整
4. 用户答 'always' → 写 ~/.openchat/trust.json, 下次不问
5. bridge 模式 (无 TTY) → 静默 allow, 打 log

## 接口签名
```js
TOOL_PERMISSION: { [toolName]: 'safe' | 'confirm' | 'forbidden' }
setEnabled(on): void
isEnabled(): bool
getPermission(name): 'safe' | 'confirm' | 'forbidden'
checkPermission(name, args, ctx?): { allowed, reason }
resetTrust(): void
listTrust(): { [key]: 'always' }
```

## 边界条件
- 未知 tool → 默认 'confirm' (保守)
- env OPENCHAT_PERMISSION 未设 / != '1' → 早返 allowed=true (0 行为变化)
- bridge 模式 (无 stdin.isTTY 或 ctx.bridgeMode) → confirm 静默 allow
- trust 损坏 / 读失败 → 当成空 trust
- 用户答非 y/n/always → 当 n

## 决策记录
- **3 档** (safe/confirm/forbidden) — Claude Code 风格, 简单够用
- **bridge 模式静默 allow** — phone 端 user 已经在看 chat, 鉴权在 chat, 不重复问
- **trust 粒度** — tool 级 (宽松) + 精确 args 级 (严格) 两层
- **失败静默** — trust 写失败不 throw, 不影响主流程

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lib/permission-gate.mjs` | singleton + check + trust | 130 |
| `lib/permission-gate.spec.md` | 本 spec | 60 |
| `22.mjs` (修改) | _execTool 前 gate | +5 |

## 不做
- per-user 权限 (单用户环境, 简化)
- 过期时间 (trust 永远有效, 用户自己 reset)
- UI 提示 (CLI 模式文字, bridge 不弹)
