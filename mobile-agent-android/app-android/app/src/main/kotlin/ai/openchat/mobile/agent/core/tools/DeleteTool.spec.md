# DeleteTool Spec

## 数据流
1. `AgentService.buildToolRegistry()` 调用 `createDeleteTool(filesDir)` 注册 `DeleteTool`
2. Agent 需要清理文件时调用 `delete` tool（变更操作需 approval checkpoint）
3. `DeleteTool.invoke(args)` 在 `Dispatchers.IO` 上执行
4. 路径被解析到 baseDir → 沙箱检查 → 根目录保护 → 存在性检查 → 目录非空检查 → 删除 → 返回 ToolResult

## 接口签名
- **Tool name**: `delete`
- **Args**:
  - `path` (required): relative file path under baseDir
- **Returns**: `ToolResult` with `deleted <rel>` on success, error on failure

## 边界条件
- `path` 为空或空白 → 返回 error "delete requires path"
- `path` 超出 baseDir sandbox → 返回 error "path outside sandbox"
- `path` 等于 baseDir 根 → 返回 error "refusing to delete sandbox root"
- 路径不存在 → 返回 error "path not found: $rel"
- 路径是非空目录 → 返回 error "not deleting non-empty directory: $rel"
- 路径是空目录 → 删除该空目录
- 路径是文件 → 删除该文件
- 删除后文件仍存在（系统调用失败）→ 返回 error "delete failed: $rel"

## 文件清单
- `DeleteTool.kt` — delete tool 实现
- `DeleteToolTest.kt` — 单元测试
- `AgentService.kt` — 注册 delete tool
