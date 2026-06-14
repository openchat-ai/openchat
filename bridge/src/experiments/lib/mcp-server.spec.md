# spec: MCP Server (lib)
> MCP (Model Context Protocol) stdio 传输实现。暴露 openchat 的 38 个工具给外部 AI 编辑器。

## 数据流
process.stdin (JSON-RPC lines) → McpServer.handle() → TOOL_LIST / executeTool → process.stdout (JSON-RPC)

## 接口签名
- `class McpServer` — handle(line): void, close(): void, _send(msg): void
- `startStdioServer()`: McpServer — 工厂函数，绑定 stdin data/end

## 边界条件
- process.stdin data 可能跨 chunk 截断：累加 buf，按 \n 分割
- _send 在 close() 后空操作
- executeTool 抛异常兜底返回 error，不崩进程
- notifications/initialized 静默忽略

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lib/mcp-server.mjs` | MCP 实现 | 120 |

## 不变量
- _send 只写 stdout
- handle 不抛，所有异常转 error 响应
- 同一 server 串行处理
