# MEMORY.md — 路由 only
> 只读当前任务相关段。勿全量注入对话。

## 路由
| 主题 | 文件/段 |
|------|---------|
| mobile-agent | `mobile-agent-android/docs/*` + 本表 mobile 行 |
| bridge crash/实验 | 专家表 P0-2/P0-3 |
| 安全 WS/隐私 | 专家表 P0-5/P0-9 |
| Flutter 超限/CI | 专家表 P0-6/P0-7 |

## mobile-agent（当前）
- branch: `mobile/android-agent-app-linear`
- alpha tag: `mobile-agent-v0.1.0-alpha`
- prod prompt: `mobile-agent-android/docs/PRODUCTION-LANDING-PROMPT.md`
- G1 已提交待推: landmine tests + CI-only verify
- 构建验证: **仅** GitHub workflow `mobile-agent-android.yml`（禁本地 gradle）
- 已知 L2: 双持久化 SettingsStore + PersistenceManager

## 专家意见跟踪（摘要）
待修仍多（R1 P0-1..11）。做专家评审前读本表，已 ✅ 不重复提。
全表备份需求时再展开 git history / 原 MEMORY 段。
