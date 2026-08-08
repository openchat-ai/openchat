# MEMORY.md — 路由 only
> 只读当前任务相关段。勿全量注入对话。

## 路由
| 主题 | 文件/段 |
|------|---------|
| mobile-agent | `mobile-agent-android/docs/*` + 本表 mobile 行 |
| bridge crash/实验 | 专家表 P0-2/P0-3 |
| 安全 WS/隐私 | 专家表 P0-5/P0-9 |

## mobile-agent（当前）
- branch: `mobile/android-agent-app-linear`
- alpha tag: `mobile-agent-v0.1.0-alpha`
- prod prompt: `mobile-agent-android/docs/PRODUCTION-LANDING-PROMPT.md`
- G1-G10 全部 CI 绿，PR #30 待 merge
- 构建验证: **仅** GitHub workflow `mobile-agent-android.yml`（禁本地 gradle）
- HEAD: `e2c652a`
- Gap #1 repoContext 已修（e340408: WorkspaceScanner + 7 角色注入, CI green）
- 55b6857: fix dangling brace from deleted persistence snapshot function
- Gap #3 worker 验证阶段已修（843178c: WorkerVerify task）
- Gap #2 worker 强制 artifact 产出：部分（工具输出已捕获为 toolOutputs，验证阶段校验非空）
- 迭代回环: e2c652a 实现 `maxIterations=3`（AgentLoop 构造参数），Auditor 拒绝时回退 Worker 重试并注入 review/critic/audit 反馈；CI 待跑
- 已知 L2: 已修（唯一写源 PersistenceManager）
- 审计 L5/L8/L9: 已修（422 / https 强制 / L9 文本）

## 专家意见跟踪（摘要）
待修仍多（R1 P0-1..11）。做专家评审前读本表，已 ✅ 不重复提。
全表备份需求时再展开 git history / 原 MEMORY 段。
