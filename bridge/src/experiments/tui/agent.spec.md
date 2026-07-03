# spec: tui/agent.mjs — Cursor 式 Agent 交互视图
> Plan 审查 → 工具流可视化 → 编辑 Diff + Accept/Reject

## 数据流
```
用户目标 → buildPlan(规则编排) → renderPlan 展示
  → 含写操作则 y/n 批准（plan mode）
  → 逐 step：
      只读工具 → executeTool → 打印结果摘要（工具流卡片）
      写工具 → previewEdit → unifiedDiff 卡片 → [a]ccept/[r]eject/[s]kip → accept 才 applyEdit
  → 完成总结
```
无 LLM 时用确定性规则 plan（demo=DNA检索+临时文件编辑；"find X"=检索）。

## 接口签名
- `agentView(providedRl?): Promise<void>` — 交互主循环；providedRl 复用外部 readline（TUI 集成）
- 内部：buildPlan(goal) / renderPlan(plan)
- 复用：coding-lib.executeTool，edit-gate.{previewEdit,unifiedDiff,applyEdit,isWriteTool}

## 边界条件
- demo 编辑仅作用于临时目录 _agent_demo，用后清理
- 写操作 previewEdit 失败（HASH_STALE/not found）→ 打印错误跳过，不落盘
- 批准 n → 不执行任何步骤
- 自建 rl 负责关闭；复用外部 rl 不关（避免关掉 TUI 的输入）

## 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| tui/agent.mjs | Agent 交互视图（plan/工具流/diff门） | 200 |
