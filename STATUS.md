# STATUS.md — 项目实时状态

> 由 openchat 实时生成，每次 push 前更新。

## 实验系统

| 维度 | 数据 |
|---|---|
| 实验总数 | **45**（38 编号 + 5 lingbao + 2 子实验） |
| closed-loop | 44 |
| paused | 1（18-guardrails） |
| lib 文件 | 37 |
| bin | `exp.mjs` + `openchat.mjs` |

### 智能水平分布

| 级别 | 数量 | 含义 |
|---|---|---|
| L0 | 17 | 纯工具/基础 |
| L1 | 4 | 单依赖编排 |
| L1.5 | 10 | 弱 AI 决策（dev-repl, chat-poller, guardian 等） |
| L2+ | 8 | 多 agent/长链（orchestrator, dream-consolidation, diagnose 等） |
| L4 | 1 | 灵保业务层（doc-gen） |
| null | 5 | 灵保信号处理，不涉及 AI |

## 最新功能（最近 15 commits）

| commit | 功能 |
|---|---|
| 560e438 | **Lab P5** — run-cron 定时跑，真正无人值守 |
| a456aab | **L3 WS push** — 推替 5s 轮询，dashboard 事件驱动 |
| 91ea093 | **L3 phone push** — lab escalate 通知 user |
| e1fdb63 | **Lab P4** — dependency graph + check-affected |
| 592c1a1 | **Lab P3** — /lab dashboard（8 API + HTML 5-tab） |
| 59c2d3c | **Lab P2** — failure-analyzer + auto-retry + escalate |
| 476d285 | **Lab P1** — history/aggregate/regression |
| 47e9093 | **Lab P0** — goal queue + runner（无人参与第一步） |
| 1f8b701 | **L1.5 multi-bridge** — 4 flag + /identity |
| aee8fad | **Step 6** — permission gate + /goal plan 展示 |
| e6f2cde | **Step 5** — subagent-roles |
| 7e446c6 | **Step 4** — neural-bridge 接 tool-loop |
| 63e7e7e | **subagent** — /task 命令 + 5 件套窄工具 |
| a704b36 | L1.5 ceiling 验证通过 |
| 98cdeed | EADDRINUSE 全路径修复（API + TCP server） |

## CLI 入口

- `openchat` — 交互式 REPL
- `openchat <tool> <args>` — 单次 executeTool
- `openchat <message>` — 起 bridge + dev-repl
- `openchat --goal X` — goal 模式
- `openchat server` — 只起 bridge

## 近期修复

| 问题 | 修复 |
|---|---|
| Windows CLI 双字符 | 关闭 bridge signalRL + `terminal:false` |
| EADDRINUSE 崩 | API + TCP server 均加 error handler，自动降级 |
| dev-repl tool call 解析 | 三层 raw JSON 回退 |
| /goal 路径 4 处 bug | levenshtein + handler case + write_file 护栏 |
| lingbao 智能分级 | 改为 `null`，只有 openchat 有分级 |

## 未推送

**38 commits 等待推送**。
