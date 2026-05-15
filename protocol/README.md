# OpenChat 协议定义

共享协议层，定义 Bridge 与 Client 之间的消息格式、RPC 接口和 P2P 通信协议。

## 待定义

- [ ] 消息类型定义 (6 种 P2P 消息类型: skill_publish, skill_request, collaboration_request, insight_share, performance_report, diagnostic_request)
- [ ] REST API 接口规范 (OpenAPI / JSON Schema)
- [ ] WebRTC 信令协议
- [ ] 音频编解码传输协议
- [ ] 节点发现与路由协议

## 设计原则

- 协议定义与实现分离 (Spec-First)
- 使用 JSON Schema 或 Protocol Buffers 做跨语言共享
- Bridge (Node.js) 和 Flutter Client 共享同一份协议定义
