# spec: edit-quality-gate

> dev-repl 改文件后自动跑 lint (opencode quality-gate 风格, 失败不阻塞但告警)

## 数据流
1. dev-repl 检测工具调用是 edit_file/write_file/multi_edit/ast_edit
2. 异步调 checkEditedFile(filePath) (不阻塞 REPL 主循环)
3. 失败结果写入 messages + history, LLM 下轮能看到
4. 成功结果静默, 不打扰

## 接口签名
```js
isEditTool(toolName): boolean                       // 工具名是否触发 lint
checkEditedFile(filePath): Promise<{                // 跑 lint
  ok: boolean, errors: [...], warnings: [...],
  summary: string, totalFiles?: number
}>
run({ op, filePath?, toolName? })                   // compose 入口
```

## 边界条件
- filePath 非字符串 → ok:false, summary='invalid filePath'
- 非 JS/TS 扩展名 (.json/.md) → ok:true, summary='skip'
- lintRun 抛错 → ok:false, summary 含 'lint 异常: ...'
- lintRun 超时 (8s) → ok:false, summary='lint 异常: timeout 8000ms'
- filePath 不存在 → lintRun 返回空结果, ok:true (无错)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/src/experiments/lib/edit-quality-gate.mjs` | 检测+执行 | 100 |
| `bridge/src/experiments/lib/dev-repl.mjs` | edit tool 后异步调 | (改 1 处) |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `[lint-gate] ✓` (改好后) | 静默 |
| C2 | `[lint-gate] ✗` (有错) | 黄色 + 写入 history |
| C3 | `lint 异常` | 异常降级 |

## 不变量
- 永不抛
- 只跑 .js/.mjs/.cjs/.ts/.jsx/.tsx
- 8s 超时硬上限
- 不修改文件 (lintRun 只读)
- 不阻塞 REPL 主循环 (异步 fire-and-forget)
