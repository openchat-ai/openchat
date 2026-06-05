# spec: system-exec
> LLM 宿主机命令执行工具。白名单安全沙箱 + OpenAI FC schema。

## 数据流

```
LLM tool_call(exec_command, {command, timeout})
  → isSafeCommand() 白名单+黑名单检查
  → execSync() 执行
  → compressOutput() 压缩输出 (可选)
  → 返回 {stdout, stderr, exitCode} JSON
```

## 接口签名

```js
isSafeCommand(cmd: string): boolean
execCommand(cmd: string, timeout?: number, compress?: boolean): { stdout: string, stderr: string, exitCode: number, _compression?: object }
executeTool(name: string, args: object): string  // 返回 JSON.stringify(result)
```

TOOLS: OpenAI function-calling schema 数组（exec_command 一个工具）

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 空命令 | isSafeCommand → false |
| 危险命令 (rm/sudo/等) | isSafeCommand → false |
| 超时 | execSync 抛异常 → 捕获返回 stderr |
| 大输出 (>100KB) | maxBuffer 限制 → execSync 抛异常 |
| 未知工具名 | executeTool → throw Error |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/tools/system-exec.mjs` | 安全执行 + FC schema | 90 |
| `src/tools/output-compressor.mjs` | CLI 输出压缩（被集成） | 110 |

## 不变量

```
// === invariants ===
// - ALLOWED_COMMANDS: whitelist of safe executables (prefix match)
// - BLOCKED_PATTERNS: regex patterns that will reject a command outright
// - timeout defaults to 10s, max output 100KB
// - execCommand() returns { stdout, stderr, exitCode }
// - TOOLS array follows OpenAI function-calling schema
// - Never executes if cmd fails safety check (throws)
```
