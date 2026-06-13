# spec: lab.mjs CLI

> lab P0 + P1 + P2 — 无人参与实验室 CLI 入口

## 命令
```
# P0
node bin/lab.mjs add "<goal desc>"        加 goal 到 queue
node bin/lab.mjs list                     列所有 goal (status/id/added/desc)
node bin/lab.mjs status                   数 {total, pending, running, done, failed}
node bin/lab.mjs run-next                 拉下一个 pending, 跑
node bin/lab.mjs run-all                  跑完所有 pending (max 100)

# P1
node bin/lab.mjs history                  看 run 历史 (last 20)
node bin/lab.mjs aggregate                per-experiment pass/fail 表
node bin/lab.mjs regression               baseline vs recent 回归检测
node bin/lab.mjs backfill                 从 queue.jsonl 补 history (一次性)

# P2
node bin/lab.mjs failures                 看失败 + 分类统计
node bin/lab.mjs escalated                列 escalated 记录
node bin/lab.mjs retry-stats              retry 统计 (transient 自动修好率)
```

## 数据流
1. CLI 解析 argv, 路由到 12 个 case
2. add → goal-queue.addGoal(desc)
3. list/status/failures → goal-queue.listGoals / getStatus / listFailed
4. run-next/run-all → runner.runNext / runner.runAll
   - runNext 内部: classify → auto-retry/escalate, 调 history.recordRun
5. history → history.listHistory, 按 finishedAt 倒序取 last 20
6. aggregate → aggregator.getExperimentStats (按 description 分组算)
7. regression → regression.detectRegressions (baseline 50% vs recent 50%)
8. backfill → history.backfillFromQueue (queue.jsonl 的 done/failed → history.jsonl)
9. failures → goal-queue.listFailed, 按 classification.category 分组 + 列详情
10. escalated → escalate.listEscalated + getEscalationStats
11. retry-stats → history 算 transient 救回率 + 尝试次数分布

## 接口签名
```
lab.mjs <cmd> [args]

cmd:
  add "<goal>"       → goal-queue.addGoal(desc) → Goal
  list | ls          → goal-queue.listGoals() → Goal[]
  status             → goal-queue.getStatus() → {total, pending, running, done, failed}
  run-next           → runner.runNext() → {ok, goal, result, classification} | {ok: false, reason}
  run-all            → runner.runAll() → Array<{ok, goal, result?, classification?}>
  history            → history.listHistory() → Run[] (last 20, 倒序)
  aggregate          → aggregator.getExperimentStats() → ExperimentStat[]
  regression         → regression.detectRegressions() → {regressions, improvements, message?}
  backfill           → history.backfillFromQueue() → {imported: number}
  failures           → goal-queue.listFailed() → Goal[] (P2)
  escalated          → escalate.listEscalated() / getEscalationStats() (P2)
  retry-stats        → 算自 history, 返 stats (P2)
```

详细接口签名见各模块的 spec.md:
- goal-queue: src/lab/goal-queue.spec.md
- runner: src/lab/runner.spec.md
- history: src/lab/history.spec.md
- aggregator: src/lab/aggregator.spec.md
- regression: src/lab/regression.spec.md
- failure-analyzer: src/lab/failure-analyzer.spec.md
- escalate: src/lab/escalate.spec.md

## 边界条件
- `add` 无 description → 退出码 1 + 提示 "Usage: lab.mjs add ..."
- `list` 空队列 → 打 `(empty queue)`
- `run-next` 无 pending → 打 `(no pending goal)`, 退出码 0 (不算错)
- `run-all` 全跑完 → 打 `ran N goal(s)` + 每个 ID 状态
- `history` 空 → 打 `(no history — run some goals first, or use "backfill")`
- `aggregate` 空 → 打 `(no runs yet — run some goals first, or use "backfill")`
- `regression` < 4 条 run → 打 `(skipped: need >= 4 runs (have N))`
- `regression` 无任何 detection → 打 `REGRESSIONS (0)` + `IMPROVEMENTS (0)`
- `backfill` 无新数据 → 打 `imported 0 run(s)`
- `failures` 空 → 打 `(no failed goals — clean run!)`
- `escalated` 空 → 打 `(no escalations)`
- `retry-stats` 空 history → 打 `(no history yet)`

## 输出格式
list 用固定列宽 (status 10 / id 22 / time 19 / desc 60-):
```
STATUS     ID                       ADDED                  DESCRIPTION
--------   --------------------     -------------------    ----------------------------------------
pending    goal-1781310934978-kczt  2026-06-13 00:35:34  只回复一个词: TEST_OK_LAB
done       goal-1781311003202-899g  2026-06-13 00:36:43  回复一个词: LAB_DURATION_TEST
```

run-next 末行:
```
[lab] goal-1781311003202-899g: OK (exit 0, 37.6s)
```

failures (P2):
```
FAILED GOALS BY CATEGORY:
  code          3
  transient     1

FAILED GOAL LIST (4):
ID                       RETRY  CATEGORY    REASON                              DESCRIPTION
------------------------  -----  ----------  ----------------------------------  ----------------------------------------
goal-1781310934978-kczt       0  code        exit code 1                          test foo bug
```

escalated (P2):
```
ESCALATION STATS:
  total: 4
  code: 3
  config: 1

TOP ESCALATED EXPERIMENTS:
    2x  test foo
    1x  test bar
```

retry-stats (P2):
```
RETRY STATS:
  goals that hit transient at least once: 3
  eventually succeeded (auto-retry saved): 2
  exhausted retries (still failed):        1
  save rate: 67%

ATTEMPTS DISTRIBUTION (history):
  attempt 1 (initial):  5
  attempt 2 (retry 1):  3
  attempt 3 (retry 2):  1
```

## 决策记录
- **不用 commander/yargs** — 12 个命令, argv 解析够用, 装依赖不值
- **list 不用 JSON** — 人读多, 固定列宽更好
- **run-all max 100** — 防死循环, 实际数据 < 10
- **status 输出 JSON** — 机器读多 (后续 P3 dashboard 抓这接口)
- **history last 20** — 多了人眼看不完, 想要 full 用 jq / 直接读 jsonl
- **aggregate 按字母序** — 稳定, 不按 pass rate 排避免跳
- **regression 50/50 split** — 简单, 不需要时间窗口
- **backfill 是一次性** — P0 阶段没写 history, 跑一次补完, 之后靠 recordRun 自动写
- **failures 跟 escalated 拆开** — failures 是"现在还挂", escalated 是"留底", 两个角度不同
- **retry-stats 只看 history** — 不读 queue, 也不读 escalated; 简单, history 够用

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bin/lab.mjs` | CLI 入口, 12 命令 | 280 |
| `src/lab/goal-queue.mjs` | queue CRUD + listFailed | 100 |
| `src/lab/runner.mjs` | runNext + runAll + _finalize (auto-retry + escalate) | 140 |
| `src/lab/history.mjs` | append-only run log | 100 |
| `src/lab/aggregator.mjs` | per-experiment 统计 | 50 |
| `src/lab/regression.mjs` | baseline vs recent 回归检测 | 120 |
| `src/lab/failure-analyzer.mjs` | classify (P2 新) | 50 |
| `src/lab/escalate.mjs` | escalated log (P2 新) | 70 |
| `bin/openchat.mjs` (现有) | --goal 模式 | (不动) |

## 不做
- 交互式 REPL (lab.mjs 一次性命令, 跑完退)
- 颜色 / 进度条 (留 P3 dashboard 一起)
- watch mode (留 P3 跟 cron 一起)
- 时间窗口过滤 (e.g. last 24h) — 留 P3
- 自动告警 (e.g. regression 时发 push) — 留 P3 / L3 phone push
- 自动修复 (e.g. exit 1 失败 → 自动改代码再跑) — 太危险
