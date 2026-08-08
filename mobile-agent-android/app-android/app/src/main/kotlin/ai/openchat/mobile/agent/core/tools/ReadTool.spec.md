# ReadTool Spec

## 数据流
1. `AgentService.buildToolRegistry()` 调用 `createReadTool(filesDir)` 注册 `ReadTool`
2. Worker/Explorer 角色在需要读取文件时调用 `read` tool
3. `ReadTool.invoke(args)` 在 `Dispatchers.IO` 上执行
4. 路径被解析到 baseDir → 沙箱检查 → 文件存在性检查 → 读取内容 → 返回 ToolResult

## 接口签名
- **Tool name**: `read`
- **Args**:
  - `path` (required): relative file path under baseDir
- **Returns**: `ToolResult` with file content on success, error on failure

## 边界条件
- `path` 为空或空白 → 返回 error "read requires path"
- `path` 超出 baseDir sandbox → 返回 error "path outside sandbox"
- 文件不存在 → 返回 error "file not found: $rel"
- 路径是目录而非文件 → 返回 error "not a file: $rel"
- 文件超过 MAX_READ_BYTES (512KB) → 截断输出并附加 "[output truncated at N bytes]"
- 读取成功 → 返回文件内容

## 文件清单
- `ReadTool.kt` — read tool 实现
- `ReadToolTest.kt` — 7 个单元测试
- `AgentService.kt` — 注册 read tool
