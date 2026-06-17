# spec: scout.mjs
> 14 个 scanner + runScoutRound() orchestrator，自动代码侦察 + finding 落盘 + 派生 goal

## 数据流
```
触发: cron.mjs 每 30s
  ↓
runScoutRound()  (orchestrator)
  ↓ 同步 scanner (P1-P5, codesmell, degradation, explore, bench, rerun)
  ↓ 异步 scanner (internet, major, npm, deepsmell)
  ↓
14 scanner 各自调用 addFinding / addGoal
  ↓
addFinding() → ~/.openchat/lab/findings.jsonl (append, 永不重复)
addGoal() → ~/.openchat/lab/queue.jsonl (已 done 永久去重)
```

## 接口签名

### Orchestrator
- `runScoutRound(): Promise<{ p1..p5, internet, degradation, explore, major, npm, codesmell, deepsmell, bench, rerun }>`: 执行一次完整扫描，返回 14 个 key 的计数对象

### 5 基础 scanner (P1-P5)
- `scanForLeftoverP2(): number`: 找 `export * from './xxx.p2.*'` 残留，命中即 finding + priority 1 goal
- `scanForSyntaxErrors(): number`: 用 acorn parseJS 解析每个 .js/.mjs, 解析失败 = finding + priority 2 goal
- `scanForLargeFiles(): number`: >200 行的文件，每文件 1 finding + priority 3 goal
- `scanForCodeSmells(): number`: 空 catch / var / console.log 三个 pattern，每命中 1 count
- `scanForMissingInvariants(): number`: >100 行且缺 `// === invariants ===` 块的文件

### 9 高级 scanner
- `scanInternet(): Promise<number>`: 读 package.json deps → npm downloads API + registry search → ratio > 2.0 / < 0.5 = finding, > 5x = priority 3 goal
- `scanDegradation(): number`: 读 history.jsonl，按 description 分组最近 5 次 run，failed >= 3 = finding, >= 4 = priority 1 goal
- `scanExplore(): number`: 读 manifest.json + history.jsonl，选最多 3 个 untested pair → finding + priority 4 goal
- `scanMajor(): Promise<number>`: fetch registry/latest，每包限 10 个，semver major 升级 = finding + priority 2 goal
- `scanNpm(): Promise<number>`: 类似 scanMajor 但 minor/patch，累加 >= 5 = finding + priority 5 goal
- `scanCodesmell(): number`: 找 `// (TODO|FIXME|XXX|HACK)` 注释，每文件 1 finding
- `scanDeepsmell(): Promise<number>`: 用 parseJS 检测函数体 > 50 行 / brace depth > 8，每文件 1 finding
- `scanBench(): number`: 按 description 分组，25th percentile 当 baseline，最近 3 次均值 > 2x baseline = finding
- `scanRerun(): number`: 读 queue.jsonl 找 status=failed 且 retryCount<3，调 updateGoal 重置为 pending

## 边界条件
- bridge/src 不存在 → P1-P5 返回 0
- 文件读取失败（权限/锁定）→ try/catch 静默，继续
- 网络超时（5s AbortSignal.timeout）→ fetchJson 返回 null, scanner 静默跳过
- 网络 404/500 → fetchJson 返回 null, 不 throw
- acorn 解析失败 → scanForSyntaxErrors 计数 + 1
- history.jsonl 不存在 → scanDegradation/scanBench 返回 0
- queue.jsonl 不存在 → scanRerun 返回 0
- manifest.json 缺失 experiments → scanExplore 返回 0
- goal 已 done → addGoal 内部 permanent dedup 跳过
- 单次 cycle < 30s (即使所有网络失败)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| scout.mjs | 14 scanner + orchestrator | 400 (允许超 200) |
| findings.mjs | append-only 日志 | 100 |
| goal-queue.mjs | goal 队列 + permanent dedup | 250 |
| history.mjs | run 历史 append-only | 100 |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|------------|------|
| C1 | `[scout] round start` | 每 30s 一次 |
| C2 | `[scout] round end p1=N p2=N ...` | 14 个数字 |
| C3 | `[scout] xxx err:` | 网络失败时偶发 |
| C4 | `findings.jsonl` 末尾 | 应有新条目 |

## 不变量
// - runScoutRound() 幂等: 相同输入产生相同 finding 列表
// - 单 scanner 5s timeout (AbortSignal.timeout), 失败静默
// - finding 永远不重复添加 (key = type+desc, append-only)
// - goal 永远不重复 add (goal-queue.mjs permanent dedup on done)
// - 全部 try/catch 静默失败, scout 不该 crash
// - 文件扫描仅限 bridge/src, 深度 ≤ 10
// - 单次 cycle < 30s (即使所有网络失败)
// - 14 scanner 全部独立 try/catch, 1 个失败不影响其他
