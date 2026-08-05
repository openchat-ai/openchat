# GlobTool Spec

## 数据流
1. `AgentService.buildToolRegistry()` 调用 `createGlobTool(filesDir)` 注册 `GlobTool`
2. Worker 角色在需要查找文件时调用 `glob` tool
3. `GlobTool.invoke(args)` 在 `Dispatchers.IO` 上执行目录遍历
4. glob pattern 转换为 regex，遍历 baseDir 下所有文件
5. 匹配的文件相对路径返回给 LLM

## 接口签名
- **Tool name**: `glob`
- **Args**:
  - `pattern` (required): glob pattern to match (e.g., `**/*.kt`, `src/*.java`)
  - `path` (optional): relative directory to search, defaults to root
  - `limit` (optional): max results, default 100, max 100
- **Returns**: `ToolResult` with matched file paths (one per line)

## 边界条件
- `pattern` 为空或空白 → 返回 error "requires pattern"
- `path` 超出 baseDir sandbox → 返回 error "outside sandbox"
- `path` 不存在 → 返回 error "path not found"
- `limit` > 100 → 自动截断到 100
- `limit` < 1 → 返回 error "must be >= 1"
- 无匹配文件 → 返回 "No files found"
- 结果超过 limit → 标记 "(truncated...)"

## 文件清单
- `GlobTool.kt` — GlobTool 类 + createGlobTool 工厂函数
- `GlobTool.spec.md` — 本文件
- `GlobToolTest.kt` — 单元测试