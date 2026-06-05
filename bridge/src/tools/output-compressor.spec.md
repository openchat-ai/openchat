# spec: output-compressor
> rtk 风格的 CLI 输出压缩器。按命令类型智能压缩，reduce token 消耗 60-80%。

## 数据流

```
cmd + stdout + stderr
  → _getStrategy() 按命令选择策略 (git_status/git_diff/ls/test/linter/truncate/none)
  → 策略专用压缩函数
  → _dedupLines() + _capLineLength()
  → { stdout, stderr, meta: { origBytes, compressedBytes, ratio, strategy } }
```

## 接口签名

```js
compressOutput(cmd: string, stdout: string, stderr: string): { stdout: string, stderr: string, meta: CompressionMeta }
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 短输出 (<100 chars) | strategy=none, 不压缩 |
| 长输出 (>50 行) | strategy=truncate, head 40 行 + tail 10 行 + 截断标记 |
| git status 输出 | 去 header，留文件列表 |
| git diff 输出 | 去 index/new mode/rename 头，留 @@ hunk |
| ls 输出 | 保留文件名 |
| 测试输出 | 过滤 PASS，保留 FAIL/ERROR |
| linter 输出 | 按 rule 分组聚合 |
| 连续重复行 | 去重保留一行 |
| 超长行 (>500 字符) | 截断 + ... 标记 |
| error/stderr | 永远不截断（仅去重） |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/tools/output-compressor.mjs` | 输出压缩全部逻辑 | 110 |

## 不变量

```
// === invariants ===
// - compressOutput(cmd, stdout, stderr) returns { stdout, stderr, meta }
// - MAX_DEFAULT_LINES: 50 lines, beyond that → truncate with head/tail
// - Known commands get specialized compression (git, ls, test runners, linters)
// - Error output is never compressed (except dedup)
// - Meta includes original/originalBytes/compressedBytes/ratio
// - Line dedup removes consecutive duplicate lines only
```
