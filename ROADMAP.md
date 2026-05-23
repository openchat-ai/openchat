# OpenChat Roadmap

## ✅ Done

- Bridge 后端（Node.js 24 ESM，Express 端口 3000）
- P2P 节点发现（hyperswarm DHT）+ ed25519 身份认证
- Agent 引擎（Think-Act-Verify 循环）
- 泛化求解器（两维度保证问题，21/29，2/3 形状自适配）
- Forge 统一入口（solve/verify/store/learn/sync）
- 向量记忆（169 条知识，embedding + TF-IDF 混合搜索）
- 跨 Bridge 知识同步（gossip 协议，LWW 冲突解决）
- Flutter 客户端（Riverpod 状态管理，12 测试）
- 结构化日志 + traceId + 死信队列

## 🔜 Next

- P2P 网络层测试覆盖（gossip、信令、WebRTC 建联）
- 置信度热榜缓存（embedding 0.5~0.8 灰色地带节省 LLM token）
- Embedding 阈值领域自适应
- Flutter widget 测试 + WebRTC e2e
- Config schema 校验
- 多领域泛化求解器扩展

## 🔭 Future

- 端到端用户体验优化（首次下载→注册→P2P 建联引导）
- AI 居民记忆回溯与反思机制
- 生产基础设施：metrics、告警、APM
- iOS App Store / Android Play Store 发布
