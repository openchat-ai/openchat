# spec: dependency-graph

> lab P4 — 静态 import 扫, 改文件 → 知道哪些 experiment 受影响

## 数据流
1. `buildGraph(repoRoot, opts)` 扫 `src/experiments/*.mjs` + `src/lab/*.mjs` (可加 dirs)
2. 每个 .mjs 用 regex 找 `from '...'`, `import '...'`, `await import('...')`
3. 解析相对路径 (`./*`, `/foo`) → join 到 repo-relative 路径
4. 跳过包名 (`express`, `fs` 等)
5. 构建双向图: files[imp_path].importers = [file_that_imports_it], experiments[file].imports = [imp_path]
6. 缓存: 进程内只 build 一次
7. `getAffectedExperiments(changedFiles)` → 找 changed files 的 importers, 只返 `src/experiments/*`

## 接口签名
```js
buildGraph(repoRoot: string, opts?: { dirs?: string[] }): Graph
getGraph(): Graph                                       // 用 cwd 探测的 repoRoot
resetCache(): void
getAffectedExperiments(changedFiles: string[]): string[]  // 只返 experiments
getFileDependents(file: string): string[]
```

Graph 形状:
```js
{
  files: { 'src/lab/goal-queue.mjs': { importers: ['src/experiments/22.mjs', ...] } },
  experiments: { 'src/experiments/22.mjs': { imports: ['src/lab/goal-queue.mjs', ...] } },
  builtAt: number,
}
```

## 边界条件
- 相对路径 `./*` 跟当前文件同目录, 解析后存在才加 (e.g. `from './goal-queue.mjs'`)
- 跨目录相对 `./lib/foo.mjs` → resolve 跟 existsSync 一起判
- 文件不存在 (e.g. `from './missing.mjs'`) → 跳过, 不报错
- 包名 (`from 'express'`) → 跳过, 不加进图
- .mjs 没 import → 空 imports 数组
- 改的本身就是 experiment (`src/experiments/22.mjs`) → 它自己也算 affected (要重测)
- 改的是 `src/lab/*` → 找 importers 里的 experiment 列表
- 改的是 `src/api/*` 或 `bin/*` (P4 不扫这些) → 不在图里, 返 []

## 决策记录
- **只扫 src/experiments/ + src/lab/** — 范围明确, 其它 (api/bin) 后续按需加
- **不递归 transitive** — 改 22.mjs 只告 22.mjs 的 importer, 不算 transitive
  (简单, 实操上: lab/*.mjs 改 → 几 个 experiment importer; 改 experiment → 它自己)
- **缓存进程级** — 一次 build 后续快; lab 假设单用户进程, OK
- **regex 扫 import** — 不引 AST 库 (e.g. acorn); 对简单 `from '...'` 够用
- **.mjs / .js 都扫** — 兼容两种扩展; bridge 现在用 .mjs, 老的 .js 也算
- **改的本身是 experiment → 算 affected** — 改了 22.mjs 就要重跑 22.mjs

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/dependency-graph.mjs` | buildGraph + getAffectedExperiments | 150 |

## 不做
- 跨语言 (Python/Rust/Dart) — lab 现在只 .mjs
- 动态 require() 字符串 — 只看字面量 import()
- Transitive 影响 (A 改 → B → C) — 留 P4 续, 或 L3
- 包版本 lockfile 解析 — 离太远
- 实时 watch 文件变化 — 留 P4+ cron 一起
- 跨 repo 依赖 — bridge 现在单 repo
