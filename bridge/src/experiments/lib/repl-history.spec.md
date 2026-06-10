# spec: repl-history

> dev-repl 的消息历史持久化，让 `openchat -c` 真正续上轮对话（之前只续 cwd）

## 数据流
1. dev-repl 每轮 user/assistant/tool 消息 → `appendMessage(chatId, msg)` 写盘
2. `openchat -c` 启动 → `loadHistory(chatId)` 读上次 messages → 灌进 `provider.chat()` 的 `messages` 参数
3. `/clear` slash 命令 → `clearHistory(chatId)` 删除文件

## 接口签名
```js
loadHistory(chatId): Message[]               // 永不抛, 失败返回 []
saveHistory(chatId, history): { ok, count }  // 原子写, 超过 1000 裁剪
appendMessage(chatId, msg): { ok, count }
clearHistory(chatId): { ok, error? }
listSessions(): string[]                     // 所有有历史的 chatId
run({ op, chatId?, history?, msg? })         // compose 契约入口
```

## 边界条件
- chatId 含 `/` 或 `..` → throw (路径穿越防护)
- chatId 长度 > 64 或含特殊字符 → throw
- 文件不存在 → loadHistory 返回 []
- JSON 损坏 → loadHistory 返回 [] (不抛)
- 并发写: 靠 .tmp + rename 原子化; 多进程并发可能丢失最后一条 (可接受)
- 消息超大 (单条 > 1MB) → 不限制 (上层调方负责)
- history 数组包含非 OpenAI 字段 → 原样保存 (load 时也不验证)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/src/experiments/lib/repl-history.mjs` | 持久化 + compose 入口 | 150 |
| `bridge/src/experiments/lib/dev-repl.mjs` | 调 loadHistory 灌进 messages / 每轮 appendMessage | (改 2 处) |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `[repl-history] load {N} msgs` | 启动 -c 时 |
| C2 | `[repl-history] save {N} msgs` | 每轮结束后 |
| C3 | `[repl-history] clear` | /clear 命令 |

## 不变量
- 路径隔离: 与 `~/.openchat/sessions.json` 物理独立
- 原子写: .tmp + rename
- chatId 白名单: `[a-zA-Z0-9_-]{1,64}`
- 单文件上限 1000 条
- load 永不抛
