# OpenChat Flutter (Agent Console) 开发文档

> **最后更新**: 2026-04-29

## 1. 项目概览
`openchat-flutter` 是一个全新的客户端，旨在将 OpenChat 从一个简单的聊天 App 升级为 **Multi-Agent 协作控制台**。它直接对接 `bridge` 的 `/api/v1` 架构，专注于 Agent 的生命周期管理和任务流展示。

## 2. 架构设计
### 2.1 核心技术栈
- **Framework**: Flutter
- **State Management**: Riverpod (提供响应式的 Agent 状态同步)
- **API Client**: Dio (处理 RESTful API 交互)
- **Model**: Freezed (确保数据模型不可变且类型安全)

### 2.2 目录结构定义
```
lib/
├── core/
│   ├── api/          # API 客户端实现 (10个文件)
│   │   ├── base_client.dart        # 基础客户端（统一认证+限流处理）
│   │   ├── agent_client.dart       # Agent 生命周期管理
│   │   ├── metrics_client.dart     # API 指标统计
│   │   ├── resources_client.dart   # 系统资源监控
│   │   ├── p2p_client.dart         # P2P 节点通信
│   │   ├── skills_client.dart      # AI 技能市场
│   │   ├── feedback_client.dart    # 反馈聚合
│   │   ├── decisions_client.dart   # 决策管理
│   │   ├── updates_client.dart     # 热更新系统
│   │   └── versions_client.dart    # 版本快照管理
│   └── models/       # 数据模型 (Agent, Feedback, Task)
├── providers/        # 全局状态管理
│   ├── config_provider.dart        # 应用配置（URL、Token、开发模式）
│   ├── client_providers.dart        # 所有 Client 的 Provider 工厂
│   └── agent_provider.dart          # Agent 状态管理
└── ui/
    ├── screens/      # 核心页面 (AgentHub, TaskDetail, Settings)
    └── widgets/      # 任务卡片, 状态指示器等通用组件
```

## 3. API 客户端总览

本客户端严格遵循 `bridge` 的 `/api/v1` 协议，不使用任何 Legacy 接口。

| 客户端 | 端点数 | 用途 |
| :--- | :--- | :--- |
| **AgentClient** | 5 | Agent 生命周期管理（创建、列表、详情、反馈、终止） |
| **MetricsClient** | 5 | API 指标统计（请求量、延迟、错误率） |
| **ResourcesClient** | 3 | 系统资源监控（CPU/内存、压缩、缓存、清理） |
| **P2PClient** | 8 | P2P 节点通信（消息、节点、收件箱） |
| **SkillsClient** | 7 | AI 技能市场（创建、验证、发布、评分） |
| **FeedbackClient** | 1 | 反馈聚合（去重、排序、生成摘要） |
| **DecisionsClient** | 4 | 决策管理（创建、列表、详情、状态更新） |
| **UpdatesClient** | 5 | 热更新系统（检查更新、应用更新、回滚） |
| **VersionsClient** | 4 | 版本快照管理（当前版本、历史、回滚） |

**总计：9 个客户端，42 个 API 端点**

## 4. API 映射规范 (v1)

### 4.1 Agent 生命周期管理
| 功能 | API 端点 | 交互逻辑 |
| :--- | :--- | :--- |
| **启动专家** | `POST /api/v1/agents` | 定义 Role → 创建 Agent → 获取 ID |
| **状态追踪** | `GET /api/v1/agents/{id}` | 轮询/监听 `status` (RUNNING → COMPLETED) |
| **结果获取** | `GET /api/v1/agents/{id}/feedback` | 获取结构化 findings 和 summary |
| **资源回收** | `DELETE /api/v1/agents/{id}` | 任务完成后强制销毁，释放 Bridge 资源 |

### 4.2 监控与资源
| 功能 | API 端点 | 用途 |
| :--- | :--- | :--- |
| **指标统计** | `/api/v1/metrics/*` | 监控 API 性能、错误率 |
| **资源状态** | `/api/v1/resources/status` | CPU、内存、网络、存储状态 |
| **资源策略** | `/api/v1/resources/policy` | 压缩、缓存、网络模式配置 |
| **清理** | `/api/v1/resources/cleanup` | 清理缓存/日志释放空间 |

### 4.3 分布式协作
| 功能 | API 端点 | 用途 |
| :--- | :--- | :--- |
| **P2P 通信** | `/api/v1/p2p/messages` | 节点间消息传递 |
| **节点管理** | `/api/v1/p2p/peers` | 发现并连接其他 Bridge |
| **技能市场** | `/api/v1/skills/*` | 创建、发布、下载 AI 技能 |
| **技能评分** | `/api/v1/skills/{id}/rate` | 评价技能质量 |

### 4.4 工作流
| 功能 | API 端点 | 用途 |
| :--- | :--- | :--- |
| **反馈聚合** | `/api/v1/feedback/aggregate` | 汇总多个 Agent 的分析结果 |
| **决策管理** | `/api/v1/decisions/*` | 记录审批 AI 建议 |
| **热更新** | `/api/v1/updates/*` | 无需重启升级系统 |
| **版本回滚** | `/api/v1/versions/*` | 回退到稳定版本 |

## 5. 关键流程设计
### 5.1 "快速对话" 流程 (Pseudo-Chat)
为了维持基础对话体验，实现如下链路：
`UserInput` → `Create Agent (role: custom)` → `Assign Task` → `Poll Feedback` → `Display Result` → `Delete Agent`.

### 5.2 Agent 状态机映射
- `INITIALIZING` → UI 显示 "加载环境..."
- `RUNNING` → UI 显示 "专家分析中..." + 进度条
- `COMPLETED` → UI 弹出 "分析完成" → 展开结果详情
- `TERMINATED` → UI 标记为 "已归档"

## 6. 使用示例

```dart
import 'package:openchat_flutter/core/api/agent_client.dart';
import 'package:openchat_flutter/core/api/metrics_client.dart';

// 初始化客户端
final agentClient = AgentClient(baseUrl: 'http://localhost:3000');
final metricsClient = MetricsClient(baseUrl: 'http://localhost:3000');

// 创建 Agent
final agent = await agentClient.createAgent(
  role: 'security_auditor',
  name: 'Code Scanner',
  task: 'Scan the repository for vulnerabilities',
);

// 查看系统指标
final metrics = await metricsClient.getSummary();
print('Total requests: ${metrics.totalRequests}');
```
