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
- HEAD: `a2f92f6 feat: add typed argument schema to tools`
- 构建验证: **仅** GitHub workflow `mobile-agent-android.yml`（禁本地 gradle）
- 已修: G1-G10 CI 绿 / Gap #1 repoContext / Gap #3 worker 验证 / 迭代回环 / Git 重试退避 / 工具 Schema 化
- 待做: Gap #4 流式反馈 / Gap #5 记忆持久化 / CI 最后统一修

## Next Move
1. Gap #4 流式反馈：让 LLM 调用能输出中间进度/工具调用事件，而非等完整结果。
2. Gap #5 记忆持久化：Worker 上下文跨里程碑/跨会话持久化。
3. CI 统一最后修。
