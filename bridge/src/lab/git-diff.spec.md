# spec: git-diff

> lab P4 — 拿 git 改的文件列表, 给 dependency-graph 用

## 数据流
1. `getChangedFiles(mode, cwd)` → spawn `git diff` 子命令
2. 按 mode 选 `--cached` / `--name-only` / `HEAD~1` 等
3. 返 repo-relative path 数组, 路径 normalize (反斜杠 → 斜杠)
4. 非 git repo / 没 commit → 返 `[]`, 不报错

## 接口签名
```js
getChangedFiles(mode?: 'staged' | 'working' | 'all' | 'last', cwd?: string): string[]

mode:
  'staged' (default): 即将 commit 的 (git diff --cached)
  'working' | 'unstaged': working tree 但未 staged
  'all': staged + working (HEAD 比)
  'last': 上次 commit (HEAD~1..HEAD)
```

## 边界条件
- 非 git repo → execSync 抛 → catch 返 `[]`
- 0 commit (刚 init) → 返 `[]`
- 0 改的文件 → 返 `[]`
- 文件名带空格 / 中文 / 路径深 → 都正常返 (execSync 转 string)
- 反斜杠 (Windows) → normalize 成 `/`, 跟 dependency-graph key 一致

## 决策记录
- **execSync 不异步** — 跟 lab 的 "单用户同步" 风格一致; 一次 git diff 几十 ms
- **失败返空不抛** — P4 caller (dependency-graph) 拿空数组 = "无 affected", 跟 "无 diff" 一致
- **不用 simple-git 等包** — 多一个依赖不值, 一行 execSync 够用
- **'staged' 跟 'cached' 同义** — 兼容 git 老术语
- **cwd 参数** — 留接口, 默认 process.cwd() (跟 P4 其它模块一致)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/git-diff.mjs` | getChangedFiles | 50 |

## 不做
- 看 staged content (只看 file list) — 留 P5 跟 diff 文本分析一起
- 解析 diff 行号 — lab 现在不需要
- 多 repo / submodule — bridge 单 repo
- 拉远端 diff (origin/main vs HEAD) — 留 CI 流程, lab 本地用不上
