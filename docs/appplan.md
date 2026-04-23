# App 客户端深度审核与优化计划

## 1. 当前架构分析
### 1.1 核心技术栈
- **框架**: Flutter (Dart)
- **状态管理**: Riverpod
- **本地存储**: Hive
- **网络通信**: 
  - WebSocket (用于信令交换)
  - WebRTC (用于 P2P 实时通信)
  - REST API (用于 Bridge 服务交互)
- **关键模块**:
  - `P2PManager`: 处理 WebRTC 连接、信令转发、数据通道管理。
  - `AI Resident/Service`: AI 功能集成。
  - `Voice Service`: 音频处理管线（包含 RNNoise 降噪）。

### 1.2 核心流程分析
- **P2P 建立流程**: Signaling Client $\rightarrow$ Offer/Answer 交换 $\rightarrow$ ICE Candidates 收集 $\rightarrow$ DataChannel 建立。
- **数据流**: 基于 `StreamController` 的响应式数据流，通过 Riverpod 分发至 UI 层。

---

## 2. 深度审核发现的问题
### 2.1 鲁棒性与稳定性
- **WebRTC 状态处理**: `P2PPeerConnection` 在状态切换时缺乏重试机制，网络波动可能导致连接直接进入 `failed` 状态而无法自动恢复。
- **内存泄漏风险**: 部分 `StreamController` 在组件销毁时可能未完全关闭，或在 `P2PManager` 销毁时未清理所有 Peer 连接。
- **异常处理**: `_handleDataChannelMessage` 中使用了简单的 `try-catch` 打印日志，缺乏针对不同错误类型的结构化处理方案。

### 2.2 性能优化点
- **JSON 序列化**: `P2PPeerConnection` 实现了一套自定义的 `_jsonEncode` 递归函数，性能低于 Dart 原生的 `jsonEncode`，且维护成本高。
- **UI 渲染**: 大量使用了 `ConsumerWidget`，在复杂页面中可能导致不必要的全页刷新，需优化为 `select` 监听。

### 2.3 安全性分析
- **信令安全**: 目前信令消息为明文传输，缺乏端到端加密（E2EE）机制，敏感信息容易被拦截。
- **输入验证**: `P2PMessage` 的 `content` 为 `dynamic`，在解析端缺乏严格的类型校验，存在潜在的注入或崩溃风险。

---

## 3. 优化实施计划

### 第一阶段：稳定性与内存优化 (Priority: High)
- [ ] **实现 WebRTC 自动重连机制**: 引入指数退避算法，在 `failed` 状态下尝试重新发起 Offer。
- [ ] **资源生命周期管理**: 审计所有 `Stream` 订阅，确保在 `dispose()` 中彻底关闭所有控制器。
- [ ] **增强错误处理**: 建立全局 `AppException` 体系，将 P2P 错误分类并上报至 UI 层。

### 第二阶段：性能与代码质量提升 (Priority: Medium)
- [ ] **重构 JSON 模块**: 移除自定义 `_jsonEncode`，统一使用 `dart:convert` 或 `json_serializable`。
- [ ] **精细化状态监听**: 将 `ref.watch(provider)` 优化为 `ref.watch(provider.select((v) => v.property))`。
- [ ] **异步初始化优化**: 优化 `main.dart` 中的初始化顺序，减少启动时的白屏时间。

### 第三阶段：安全性与功能增强 (Priority: Medium)
- [ ] **引入端到端加密 (E2EE)**: 在 DataChannel 层实现基于 Diffie-Hellman 的密钥交换和 AES-GCM 加密。
- [ ] **增强消息校验**: 为 `P2PMessage` 定义严格的 Schema 校验机制。
- [ ] **优化音频 pipeline**: 进一步调优 `RNNoise` 处理参数，降低语音传输延迟。

---

## 4. 预期目标
- **稳定性**: P2P 连接成功率提升至 95% 以上，内存占用降低 10-15%。
- **安全性**: 实现核心聊天数据的端到端加密，防止信令服务器嗅探。
- **可维护性**: 消除冗余的自定义序列化代码，提高代码的可读性和可测试性。
