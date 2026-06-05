# spec: coding-tools
> LLM 编程 Agent 的文件操作工具链。读/写/搜索替换编辑/hashline 编辑 + **质量门禁默认开启**。

## 数据流

```
LLM tool_call(edit_file, {path, search, newStr})
  → editFile() 含质量门禁
  → snapshot 保存原始内容
  → applyWithGuard: snapshot → _editFileRaw → runLint → (可选 runTests)
  → 全部通过 → 保留编辑；lint失败 → restore 回滚
  → 返回 {pass: true, path, oldBytes, newBytes}
  → force=true 跳过质量门禁

LLM tool_call(write_file, {path, content})
  → mkdir + write (无质量门禁，适用新建文件)

LLM tool_call(read_file, {path})
  → read + return content
```

## 接口签名

```js
readFile(filePath: string): Promise<string>
writeFile(filePath: string, content: string): Promise<{ path, bytes }>
editFile(filePath, search, newStr, options?: { force?, lint?, test? }): Promise<{ pass, path, oldBytes, newBytes }>
hashEdit(filePath, hash, newContent): Promise<{ path, line }>
executeTool(name: string, args: object): Promise<any>
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 路径穿越 (../../) | resolved.startsWith check → throw |
| 文件不存在 | readFile → ENOENT throw |
| search 不存在 | editFile → throw "not found" |
| search 不唯一 | editFile → throw "not unique" |
| hash 锚点不存在 | hashEdit → throw "not found" |
| lint 失败 (默认) | applyWithGuard → restore → throw |
| 父目录不存在 | writeFile → mkdir recursive |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/tools/coding-tools.mjs` | 文件操作 + 质量门禁集成 | 140 |
| `src/tools/quality-gate.mjs` | 快照/验证/回滚管道 | 100 |

## 不变量

```
// === invariants ===
// - editFile 默认开启质量门禁 (lint check)；force=true 跳过
// - editFile 校验 search 字符串唯一存在后才替换
// - 所有文件操作路径基于 PROJECT_ROOT 做穿越防护
// - TOOLS 只有 read_file, write_file, edit_file 三个
// - safe_edit/safe_write 已移除，功能合并入 edit_file
```
