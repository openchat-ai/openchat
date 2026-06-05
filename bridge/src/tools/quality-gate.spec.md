# spec: quality-gate
> 质量门禁：文件快照 → 编辑 → lint/test 验证 → 失败自动回滚。edit_file 的默认行为。

## 数据流

```
applyWithGuard(filePath, editFn, {lint, test})
  → snapshot(filePath) 保存原始内容
  → editFn() 执行编辑，捕获 editResult
  → 如果 lint=true → runLint()，失败则 restore() → {pass:false, step:'lint'}
  → 如果 test=true → runTests()，失败则 restore() → {pass:false, step:'test'}
  → 全部通过 → clear snapshot → {pass:true, ...editResult}
```

## 接口签名

```js
snapshot(filePath: string): Promise<{ filePath, bytes }>
restore(filePath: string): Promise<{ filePath, restoredBytes }>
hasSnapshot(filePath: string): boolean
runLint(cwd?: string): { pass, output }
runTests(testPaths?, cwd?): { pass, output, failedTests }
applyWithGuard(filePath, editFn, options?): Promise<{ pass, step?, error?, output?, ...editResult }>
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 快照覆盖 | 第二次 snapshot 覆盖第一次 |
| 无快照调用 restore | throw "No snapshot" |
| lint 命令不存在 | runLint → { pass: false, output: error } |
| editFn 抛异常 | applyWithGuard → restore → { pass:false, step:'edit', error } |
| 验证通过 | snapshot 清除，透传 editResult |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/tools/quality-gate.mjs` | 快照/验证/回滚管道 | 100 |

## 不变量

```
// === invariants ===
// - applyWithGuard() 成功时透传 editFn 返回值: {pass:true, ...editResult}
// - snapshot store 是内存 Map<filePath, {content, ts}>
// - restore() 写回原始内容
```
