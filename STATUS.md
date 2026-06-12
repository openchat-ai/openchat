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
| L0 | 22 | 纯工具/基础（config, coding-tools, qiniu, 存储等） |
| L1 | 4 | 单依赖编排（provider-kit, skill-loader, codec 等） |
| L1.5 | 10 | 弱 AI 决策（dev-repl, chat-poller, Teach-Me, guardian 等） |
| L2+ | 8 | 多 agent/长链（orchestrator, dream-consolidation, diagnose 等） |
| L4 | 1 | 灵保业务层（doc-gen） |

## 最新提交

```
a704b36 feat: l1.5 ceiling 验证 — 件 5 c+d + swap-m2.mjs + report
f17d549 fix(bridge): EADDRINUSE 自动降级无网络模式
43f49b6 fix(openchat): Windows 双字符 — 关闭 bridge signalRL + terminal:false
046c000 feat: 51-diagnose — tier2-bare-json fingerprint (m3 raw json tool call)
64605e3 fix: dev-repl parser — add raw json fallback (3 layers) for non-xml tool call formats
```

## 关键修复（最近）

| 问题 | 修复 |
|---|---|
| Windows CLI 双字符 | 关闭 bridge signalRL + `terminal:false` |
| EADDRINUSE 崩 | 自动降级无网络模式 |
| dev-repl tool call 解析 | 三层 raw JSON 回退 |
| L1.5 ceiling 验证 | 5 组件全通过 |

## CLI 入口

- `openchat` — 交互式 REPL（工具/LLM 混合）
- `openchat <tool> <args>` — 单次 executeTool
- `openchat <message>` — 起 bridge + dev-repl
- `openchat --goal X` — goal 模式
- `openchat server` — 只起 bridge

## 已知待办

- 18-guardrails 暂停，需重构
- lingbao L1 硬件 + L3 UI 依赖外部环境（skeleton）
