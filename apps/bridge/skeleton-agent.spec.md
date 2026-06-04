# spec: skeleton-agent tool execution

> 给 openchat agent 增加识别并执行系统指令/工具的能力

## 数据流

```
用户文本 → processText(text)
  → LLM chat（含 tool definitions）
    → LLM 返回 text 或 tool_calls
      ↓ tool_calls           ↓ text（直接回复）
  执行工具（本地）             返回回复
    → 结果送回 LLM
    → LLM 最终回复
  → { response, toolCalls }
```

## 接口签名

```js
// apps/bridge/skeleton-agent.mjs
async function initProvider();

async function processText(text, { tools } = {}) → {
  response: string,           // LLM 最终文本回复
  toolCalls: Array<{          // 已执行的工具调用记录
    name: string,
    params: Object,
    result: any
  }>
}

// 工具定义
const TOOLS = [
  {
    name: 'run_command',
    description: '执行 shell 命令',
    params: { command: 'string', cwd: 'string?' }
  },
  {
    name: 'read_file',
    description: '读取文件内容',
    params: { path: 'string' }
  },
  {
    name: 'write_file',
    description: '写入文件',
    params: { path: 'string', content: 'string' }
  },
  {
    name: 'search_code',
    description: '搜索代码内容',
    params: { pattern: 'string', path: 'string?' }
  }
]
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| LLM 返回多个 tool_calls | 串行执行，每个结果依次送回 LLM |
| 工具执行失败（命令不存在/权限不足） | 错误信息送回 LLM，由 LLM 决定重试或放弃 |
| 工具输出超过 100KB | 截断到 100KB，附 `(truncated)` 标记 |
| tool_calls 循环超过 5 轮 | 强制终止，返回最后一轮文本回复 |
| tools 参数为空/未传 | 退化为纯文本对话（当前行为） |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `apps/bridge/skeleton-agent.mjs` | agent 入口，工具定义 + 执行循环 | 120 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C13d | `[C13d]` | processText | `tool_call: name, params` |
| C13e | `[C13e]` | processText | `tool_result: name, ok` |

## 不变量

```
// === invariants ===
// - 工具执行永不在 LLM 上下文中暴露 apiKey/token/password
// - 破坏性命令（rm -rf / del / format）执行前记录日志
// - 工具调用最多 5 轮，防止无限循环
// - 截断工具输出时在末尾标记 (truncated)
```
