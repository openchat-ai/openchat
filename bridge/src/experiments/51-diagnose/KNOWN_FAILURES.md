# 51-diagnose 已知失败模式库

移植自 openchat L1.5 live test 历史 (v1/v2/v3 全 FAIL 的根因) + C-PLAN §5 失败模式穷举 + OPENCHAT-BEHAVIOR-SPEC §3 错误自救.

每条 fingerprint 都是 `(id, label, patterns, rootCause, loop, scaffold, tier)`. 51-diagnose 内部 hardcode, 自包含.

---

## 1. round0-zero-tool-call
- **label**: round 0 零 tool call
- **典型 transcript**: `[tier2-retry] round 0 no tool call, retrying (1/2)`
- **根因**: user prompt 没强制 tool_choice=required / 弱模型不知道"必须调工具"
- **feedback loop**: `rewrite-user-prompt` (Tier 1) → `force-tool-choice`
- **5 件套 v2**: 件 1 (动作级 tool 约束) + 件 2 (窄工具集)
- **tier**: 1 (已有 hotfix, 应该是闭环的)

## 2. hallucinated-system-reminder
- **label**: 幻觉 system-reminder 服从
- **典型 transcript**: `model complied with the fake system message` 或 user 输入里出现 `system-reminder: ...`
- **根因**: transport 层不区分 user/system role, 信任 user 输入字面
- **feedback loop**: `strip-system-reminder` → `assert-role-boundary`
- **5 件套 v2**: 件 4 (可恢复执行 — transport role 隔离) + 件 1
- **tier**: 2 (需补 transport 层)

## 3. narrative-instruction-low-compliance
- **label**: narrative 指令字面服从率低
- **典型 transcript**: `模型忽略字数/格式/语气指令`
- **根因**: M3 弱模型, narrative 指令字面服从率本就低
- **feedback loop**: `switch-strong-model` (M2/Sonnet)
- **5 件套 v2**: 件 5 (执行边界 — 切强模型)
- **tier**: 3 (需切强模型)

## 4. systemmsg-strong-constraint-no-effect
- **label**: M3 字面服从 systemMsg 强约束 0 效果
- **典型 transcript**: `systemMsg 加了硬约束 (必用工具/必不调某工具), M3 完全忽略`
- **根因**: M3 对 system role 的字面服从率低于 user role
- **feedback loop**: `user-role-promotion` → `differential-test`
- **5 件套 v2**: 件 4 (可恢复执行 — role 区分)
- **tier**: 2 (transport 层 + 切约束位置)

## 5. tier2-retry-no-change
- **label**: Tier 2 retry 触发但 LLM 反应不变
- **典型 transcript**: `[tier2-retry] round 0 no tool call, retrying (2/2)` 然后卡死
- **根因**: round 0a content="" 没清, retry 复用旧 history
- **feedback loop**: `clear-empty-content` → `switch-strong-model`
- **5 件套 v2**: 件 4 (state 清零) + 件 5 (切强模型)
- **tier**: 2

## 6. max-rounds-hit
- **label**: max rounds 撞 30
- **典型 transcript**: `[loop abort]` / `hit 30 rounds` / `轮次超`
- **根因**: 任务对模型太难 / 任务可拆但没拆
- **feedback loop**: `task-split` → `easier-task` (E40 档降难度)
- **5 件套 v2**: 件 3 (强契约 — 任务拆分) + 件 1 (narrow scope)
- **tier**: 2

## 7. json-stringify-failover
- **label**: JSON.stringify 失败误触发 failover
- **典型 transcript**: `JSON.stringify threw on circular/undefined, triggered provider failover`
- **根因**: try/catch 缺失, 错误被吞成 provider fault
- **feedback loop**: `try-catch-wrap` → `reproducer-minimal`
- **5 件套 v2**: 件 4 (可恢复执行 — try/catch 边界)
- **tier**: 1 (P1-C 已修)

## 8. magic-tag-not-rescued
- **label**: magic 标签没自动救
- **典型 transcript**: 模型输出 `[STOP]` / `[GP]` / `[lint-gate]` / `[tier2-retry]` 等特殊标签, 系统没当 stop signal 救场
- **根因**: cheat sheet 没注入 / pattern 没注册到 exit detector
- **feedback loop**: `inject-cheat-sheet` → `register-exit-pattern`
- **5 件套 v2**: 件 1 (cheat sheet 注入)
- **tier**: 1 (P0 已修)

## 9. failover-hang-no-stream
- **label**: failover 阶段 stall (200 OK 但 body 不来 / 端点不通)
- **典型 transcript**: `provider unreachable, timeout` / `200 OK but no stream, body never arrived` / `stream hang detected`
- **根因**: 上游 provider 网络/区域限制, 或 stream 协议层 hang; 当前 health check 太宽松, 仅看 HTTP status
- **来源**: aaa50d48 live 报告
- **feedback loop**: `switch-strong-model` → `reproducer-minimal`
- **5 件套 v2**: 件 3 (强契约 — provider health check 加 stricter ping, 200 OK 不算通, 必须拿到 stream 头或 body 起始字节) + 件 4 (可恢复执行 — failover 上限 1 次, 不无限重试)
- **tier**: 2
- **fallback hypothesis**: 切 openrouter/auto 路由, 让它自己选 region-可达的 model

## 10. provider-region-block
- **label**: provider 在当前 region 不可用
- **典型 transcript**: `403 Forbidden` / `not available in your region` / `403 ... region`
- **根因**: provider 在当前地理区域不可达, 单一 provider 配置无 region 感知
- **来源**: a3f75eb0 报告 Part 1
- **feedback loop**: `switch-strong-model` → `reproducer-minimal`
- **5 件套 v2**: 件 4 (可恢复执行 — region-aware fallback chain, openrouter/auto 永远兜底, 让它自己选 region-可达的 model)
- **tier**: 2

## 11. clear-empty-content
- **label**: Tier 2 retry messages 被空 content 污染
- **典型 transcript**: `last user message content = ""` + `[tier2-retry] round 0` 后续无 tool-call indicator
- **根因**: messages.splice 之前没删空 content 元素, 弱模型复读空消息导致反应一致
- **来源**: a26cfad6 报告 Tier 2 bug
- **feedback loop**: `clear-empty-content` → `switch-strong-model`
- **5 件套 v2**: 件 4 (可恢复执行 — retry 前清空 content="" 的元素, 防止污染下一轮)
- **tier**: 2

---

## 移植来源

- mattpocock/skills `engineering/diagnose` SKILL.md (Phase 1 + 3)
- 移植策略: Phase 1 (建 feedback loop) + Phase 3 (3-5 ranked falsifiable hypothesis)
  - **Phase 1 + scaffold 推荐**: 纯启发式 (regex + 关键词 + 模板), 不调 LLM
  - **Phase 3 hypothesis**: LLM-driven (调 provider-kit), fallback 到本地
- **不做**: Phase 4-6 (instrument / fix / regression), 那是修, 不是诊断

## 5 件套 v2 (cplan_scaffold_decision.md)

| 件 | 名称 | 用途 |
|---|---|---|
| 1 | 动作级 tool | tool_choice=required / 窄工具集 / 反幻觉 guard |
| 2 | 窄工具集 | narrow toolset, 模型无可推诿余地 |
| 3 | 强契约 | I/O schema 严格校验 + 结构化输出 |
| 4 | 可恢复执行 | try/catch + state 清零 + role 隔离 + retry policy |
| 5 | 执行边界 | max rounds / max tokens / 切强模型 / HITL |
