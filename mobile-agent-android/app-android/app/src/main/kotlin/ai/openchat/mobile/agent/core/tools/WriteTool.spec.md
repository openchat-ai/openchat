# WriteTool Spec

## 数据流
1. `AgentService.buildToolRegistry()` 调用 `createWriteTool(filesDir)` 注册 `WriteTool`
2. Worker 角色在需要创建/修改文件时调用 `write` tool
3. `WriteTool.invoke(args)` 在 `Dispatchers.IO` 上执行
4. 路径被解析到 baseDir → 沙箱检查 → 创建父目录 → 写入内容 → 返回 ToolResult

## 接口签名
- **Tool name**: `write`
- **Args**:
  - `path` (required): relative file path under baseDir
  - `content` (optional, default: empty string): file content to write
- **Returns**: `ToolResult` with success message on success, error on failure

## 边界条件
- `path` 为空或空白 → 返回 error "write requires path"
- `path` 超出 baseDir sandbox → 返回 error "path outside sandbox"
- 父目录不存在 → 自动创建 (mkdirs)
- 文件已存在 → 覆盖写入
- 写入成功 → 返回 "wrote N bytes to $rel"

## 文件清单
- `WriteTool.kt` — write tool 实现
- `WriteToolTest.kt` — 7 个单元测试
- `AgentService.kt` — 注册 write tool
