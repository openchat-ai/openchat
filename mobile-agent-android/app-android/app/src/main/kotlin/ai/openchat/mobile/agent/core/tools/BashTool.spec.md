# BashTool Spec

## 数据流
1. `AgentService.buildToolRegistry()` 调用 `createBashTool(filesDir)` 注册 `BashTool`
2. Worker 角色在需要执行 shell 命令时调用 `bash` tool
3. `BashTool.invoke(args)` 在 `Dispatchers.IO` 上执行 `ProcessBuilder` 启动 shell 进程
4. 命令通过 `/bin/sh -c <command>` (POSIX) 或 `cmd.exe /c <command>` (Windows) 执行
5. 输出被捕获并返回给 LLM，exit code 非零时 error 字段被设置

## 接口签名
- **Tool name**: `bash`
- **Args**:
  - `command` (required): shell command string to execute
  - `workdir` (optional): relative working directory under baseDir, defaults to root
  - `timeout` (optional): timeout in seconds, default 30, max 300
- **Returns**: `ToolResult` with stdout/stderr combined output and error field on non-zero exit

## 边界条件
- `command` 为空或空白 → 返回 error "bash requires command"
- `workdir` 超出 baseDir sandbox → 返回 error "workdir outside sandbox"
- `workdir` 不存在或非目录 → 返回 error "workdir not found"
- `timeout` > 300s → 返回 error "timeout exceeds maximum"
- `timeout` < 1s → 返回 error "timeout must be >= 1s"
- 命令超时 → 进程被强制终止，返回 error "bash timed out"
- 输出超过 1MB → 截断并标记 "[output truncated at ...]"
- shell 进程 exit code 非零 → error 字段设为 "bash exited with code N"

## 文件清单
- `BashTool.kt` — BashTool 类 + createBashTool 工厂函数
- `BashTool.spec.md` — 本文件
- `BashToolTest.kt` — 单元测试