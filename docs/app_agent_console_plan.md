# App 端 Multi-Agent 控制台适配方案

## 1. 总体目标
将 OpenChat App 从一个简单的“聊天客户端”升级为“多代理协作控制台”，在不改动 Bridge 后端代码的前提下，通过重构 App 业务逻辑，使其全面适配 `bridge` 的 `/api/v1` 架构。

## 2. 交互模式映射 (UX Mapping)

由于新版 Bridge 采用了“资源管理型”接口，App 的交互逻辑需进行如下映射：

| 传统聊天行为 | Agent 控制台实现逻辑 | 对应 API 链路 |
| :--- | :--- | :--- |
| **发送消息** | 1. 创建临时 `chat_agent` $\rightarrow$ 2. 将内容设为 `task` | `POST /api/v1/agents` |
| **等待回复** | 轮询或监听 Agent 的 `feedback` 状态 | `GET /api/v1/agents/{id}/feedback` |
| **对话历史** | 将历史消息转化为 Agent 的 `task` 上下文 | `POST /api/v1/agents` $\rightarrow$ `task` |
| **管理 AI** | 展示当前 Bridge 内所有活跃的专家代理 | `GET /api/v1/agents` |
| **终止对话** | 显式终止该 Agent 实例 | `DELETE /api/v1/agents/{id}` |

---

## 3. 核心技术实现方案

### 3.1 `BridgeService` 重构
放弃所有 `/api/chat` 路径，引入 `AgentManager` 逻辑：
- **快捷对话流 (Fast-track)**: 实现一个内部方法 `sendQuickChat(message)`，自动完成 `创建 $\rightarrow$ 轮询 $\rightarrow$ 销毁` 的全生命周期管理。
- **状态同步**: 使用 Riverpod 实时同步 `agents` 列表，保证 UI 能够实时反映后端 Agent 的运行状态。

### 3.2 状态机适配
App 需实现针对 Agent 状态的 UI 响应：
- `INITIALIZING`: 显示“AI 正在准备环境...”
- `RUNNING`: 显示“AI 专家正在分析中...” $\rightarrow$ 配合进度条
- `COMPLETED`: 显示最终 `feedback` 内容 $\rightarrow$ 转换为对话气泡

---

## 4. UI/UX 演进路线图

### 阶段 1：最小可用对话 (Minimal Viable Chat)
- **目标**: 让用户能通过原有的对话界面拿到 AI 回复。
- **实现**: 仅在 `BridgeService` 内部通过 API 组合模拟对话流，界面保持不变。

### 阶段 2：Agent 观测面板 (Observability)
- **新增页面**: `AgentListScreen`。
- **功能**: 
  - 列出 `security_auditor`, `test_engineer` 等所有运行中的专家。
  - 查看每个 Agent 的 `capabilities` (能力集) 和 `status`。

### 阶段 3：全量控制台 (Full Console)
- **功能增强**:
  - **手动创建**: 允许用户选择角色模板创建专家代理。
  - **反馈分析**: 提供结构化的反馈查看器，支持查看 `findings` 和 `confidence`。
  - **协作监控**: 观察主 AI 与次 AI 之间的协作记录。

---

## 5. 关键链路风险与对策
- **延迟问题**: 创建 Agent $\rightarrow$ 轮询 $\rightarrow$ 回复 的链路比直接 Chat 慢。
  - *对策*: 在 UI 层引入“思考中”的中间状态，并优化轮询频率（如从 5s 优化为 2s）。
- **资源浪费**: 频繁创建 `chat_agent` 可能导致 Bridge 端 Agent 堆积。
  - *对策*: 严格执行 `COMPLETED` 后立即调用 `DELETE /api/v1/agents/{id}` 的清理机制。
