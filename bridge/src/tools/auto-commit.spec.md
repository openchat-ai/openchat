# spec: auto-commit
> Git 原子提交工具：git add → diff 分析 → commit message 自动生成 → git commit。

## 数据流

```
autoCommit(filePaths)
  → hasGitRepo() 检查
  → gitAdd(filePaths) stage 文件
  → gitDiff() --cached 获取 diff
  → generateMessage(diff) 分析变更类型(feat/fix/docs/refactor/test/chore)
  → git commit -m "{message}"
  → {committed, message, files}
```

## 接口签名

```js
hasGitRepo(cwd?: string): boolean
gitAdd(filePaths: string|string[], cwd?: string): { staged }
gitDiff(cwd?: string): string
generateMessage(diff: string, cwd?: string): string
autoCommit(filePaths: string|string[], cwd?: string): Promise<{ committed: boolean, message?: string, files?: string[], error?: string }>
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 不在 git 仓库 | autoCommit → { committed: false, error: 'Not a git repository' } |
| 空 diff | generateMessage → 'chore: auto-commit' |
| commit 失败 (hook 拒绝) | autoCommit → { committed: false, error: hook output } |
| 文件未更改 | git diff --cached 空 → 'chore: auto-commit' |
| diff 含 fix 关键词 | type=fix |
| diff 含 test 关键词 | type=test |
| diff 含 docs/README | type=docs |
| 有 scope (文件路径第一段) | message = "type(scope): description" |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/tools/auto-commit.mjs` | git stage + message 生成 + commit | 100 |

## 不变量

```
// === invariants ===
// - autoCommit(filePaths) stages files, generates message from git diff, commits
// - commitMessage() calls `git diff --cached` to generate descriptive message
// - Falls back to "chore: auto-commit" if diff is empty
// - commitFormat: "type(scope): description"
// - Only works inside a git repo
```
