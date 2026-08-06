# ListTool Spec

## 数据流
1. `AgentService.buildToolRegistry()` 调用 `createListTool(filesDir)` 注册 `ListTool`
2. Worker/Explorer 角色在需要浏览目录时调用 `list` tool
3. `ListTool.invoke(args)` 在 `Dispatchers.IO` 上执行
4. 路径被解析到 baseDir → 沙箱检查 → 存在性检查 → 目录检查 → 列出条目 → 返回 ToolResult

## 接口签名
- **Tool name**: `list`
- **Args**:
  - `path` (required): relative directory path under baseDir
  - `recursive` (optional, default `false`): 递归遍历子目录
- **Returns**: `ToolResult` with directory listing on success, error on failure

## 边界条件
- `path` 为空或空白 → 返回 error "list requires path"
- `path` 超出 baseDir sandbox → 返回 error "path outside sandbox"
- 路径不存在 → 返回 error "path not found: $rel"
- 路径是文件而非目录 → 返回 error "not a directory: $rel"
- 空目录 → 返回 "(empty directory)"
- `recursive=true` → 递归列出所有子目录与文件，目录用 `[DIR] ` 前缀、文件用 `[FILE] ` 前缀，子项带缩进
- `recursive` 缺失或非 "true" → 仅列出当前目录直接子项
- 条目按名称字母序排序

## 文件清单
- `ListTool.kt` — list tool 实现
- `ListToolTest.kt` — 7 个单元测试
- `AgentService.kt` — 注册 list tool
