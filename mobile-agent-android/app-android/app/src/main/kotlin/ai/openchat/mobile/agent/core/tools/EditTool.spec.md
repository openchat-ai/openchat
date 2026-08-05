# EditTool Spec

## 数据流
1. `AgentService.buildToolRegistry()` 调用 `createEditTool(filesDir)` 注册 `EditTool`
2. Worker 角色在需要修改文件时调用 `edit` tool
3. `EditTool.invoke(args)` 在 `Dispatchers.IO` 上执行
4. 文件被读取到内存 → 精确匹配 `old_string` → 替换为 `new_string` → 写回文件
5. 返回 ToolResult，error 字段在匹配失败/多匹配/沙箱越界时被设置

## 接口签名
- **Tool name**: `edit`
- **Args**:
  - `path` (required): relative file path under baseDir
  - `old_string` (required): exact string to find in file (must be unique)
  - `new_string` (required): replacement string
- **Returns**: `ToolResult` with success message on success, error on failure

## 边界条件
- `path` 为空或空白 → 返回 error "edit requires path"
- `old_string` 为空 → 返回 error "edit requires old_string"
- `new_string` 为空 → 返回 error "edit requires new_string"
- `path` 超出 baseDir sandbox → 返回 error "path outside sandbox"
- 文件不存在 → 返回 error "file not found: $rel"
- `old_string` 在文件中找不到 → 返回 error "old_string not found in $rel"
- `old_string` 在文件中匹配多次 → 返回 error "old_string found N times in $rel; must be unique"
- 替换成功 → 返回 "edited $rel (replaced 1 occurrence, ${totalBytes} bytes total)"

## 文件清单
- `EditTool.kt` — EditTool 类 + createEditTool 工厂函数
- `EditTool.spec.md` — 本文件
- `EditToolTest.kt` — 单元测试
