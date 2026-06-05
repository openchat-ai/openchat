# spec: project-context
> 项目上下文分析。LLM 编程 Agent 的 "项目理解" 层：发现关联文件、解析 import 依赖、扫描目录结构。

## 数据流

```
findRelatedFiles(filePath)
  → 扫描同目录同名不同后缀文件 (a.js ↔ a.test.js)
  → 返回 [{path}]

findDependencies(filePath)
  → 解析 import/require/dynamic import
  → 相对路径 → resolve 到真实文件
  → 包名 → 标记为 node_modules/{name}
  → 返回 [{specifier, resolved}]

getProjectStructure(root, maxDepth=3)
  → BFS 遍历目录
  → 跳过 node_modules/.git/dist/build
  → 返回 [{type, path}]
```

## 接口签名

```js
findRelatedFiles(filePath: string): Promise<string[]>
findDependencies(filePath: string): Promise<{ specifier: string, resolved: string|null }[]>
getProjectStructure(root?: string, maxDepth?: number): Promise<{ type: 'dir'|'file', path: string }[]>
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 文件不存在 | findDependencies → [] |
| 无 import 语句 | findDependencies → [] |
| 相对路径 import 无法 resolve | resolved=null |
| 第三方包 import | resolved="node_modules/{name}" |
| 目录深度 > maxDepth | 停止遍历 |
| node_modules 等目录 | 跳过 |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/tools/project-context.mjs` | 依赖分析 + 结构扫描 | 110 |

## 不变量

```
// === invariants ===
// - findRelatedFiles(filePath) scans imports/exports and finds connected files
// - findDependencies(filePath) lists direct imports + their resolution
// - getProjectStructure(root) returns directory tree up to 3 levels
// - Only reads files, never modifies
```
