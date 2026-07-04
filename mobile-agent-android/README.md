# mobile-agent-android

独立 Android Agent App 工作区（与现有 openchat 代码隔离）。

## 开发边界（必须遵守）
- 仅在 `mobile-agent-android/**` 下开发
- 不修改现有 openchat 既有目录与构建逻辑
- 新增 CI 仅针对 `mobile-agent-android/**` 触发

## 目标能力（分期）
- Ask / Agent 双模式
- E43 风格 Agent Loop（Plan -> Tools -> Trace）
- E46 风格 Edit Gate（dry-run diff + HASH_STALE + accept/reject）
- 多 Provider / 多模型（OpenAI-compatible）
- GitHub 分支开发闭环（branch/commit/push/PR）

## 目录说明
- `app-android/`：Android 原生工程（Kotlin + XML/AppCompat）
- `core/agent/`：E43 Loop 核心
- `core/editgate/`：E46 Gate 核心
- `core/tools/`：工具执行层
- `core/modelrouter/`：模型路由与 fallback
- `core/github/`：GitHub 流程能力
- `core/ci/`：CI 对接能力
- `docs/`：设计与验收文档
- `scripts/`：开发脚本

## 当前状态
P0-3 进行中：工程壳已可整理为单线分支，离线 Agent Loop + Edit Gate 演示链路已接通。

## 已完成
- Gradle 工程根配置修复，wrapper 脚本已补齐
- 启动页切换为可操作的 Agent 控制面板
- `AgentLoop` 具备离线计划、审批、dry-run diff、trace 日志
- `EditGate` / `ModelRouter` 已进入本地 MVP 闭环

## 仍未完成
- Android SDK 环境接入后的真机构建验证
- Provider API 接线（当前 `ModelRouter` 仍是离线 scripted provider）
- GitHub 分支/提交/PR 真正联网实现（当前 `GitHubClient` 仍是 stub）
