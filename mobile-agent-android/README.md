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
- `app-android/`：Android 原生工程（Kotlin + Compose）
- `core/agent/`：E43 Loop 核心
- `core/editgate/`：E46 Gate 核心
- `core/tools/`：工具执行层
- `core/modelrouter/`：模型路由与 fallback
- `core/github/`：GitHub 流程能力
- `core/ci/`：CI 对接能力
- `docs/`：设计与验收文档
- `scripts/`：开发脚本

## 当前状态
P0-1 初始化中：目录骨架已建立，等待接入 Android 工程壳与三页面骨架。
