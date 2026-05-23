# 术语表

> **版本**: 3.0 | **更新时间**: 2026-05-16

---

## 系统

### Bridge
一个 OpenChat 节点。运行 P2P 网络、语音管线、AI 居民系统。每个 Bridge 是一台电脑/服务器。

### hostId
物理机器的稳定 UUID。首次启动生成，存于 `~/.openchat/config.json`。重启不变。

### houseId
Bridge 实例标识。格式：`house_<hostId前缀>_<port>`。

### bridgeId
P2P 网络中的临时标识。格式：`bridge_<ts>_<rand>`，每次启动重新生成。

---

## P2P 网络

### DHT
分布式哈希表。节点通过 hyperswarm 互相发现，无中央服务器。

### WebRTC
浏览器/客户端间的实时音视频传输。Bridge 做信令服务器，转发 SDP/ICE。

### 直连 (Direct TCP)
同一局域网内绕过 DHT，直接 TCP 连接。

---

## 语音

### RNNoise
神经网络降噪库 (WASM 编译)。实时去除背景噪音，<1ms 延迟。

### 神经音频编解码器
自研音频压缩。104x 压缩比，3.7kbps 码率，<1ms 编码延迟。

---

## AI 居民 [实验]

### Resident (居民)
在 Bridge 中运行的 AI 实体。有名字、性格 (traits)、记忆、行为循环。依赖外部 LLM API 进行"思考"。

### 身体 (House/Body)
居民所在的 Bridge 物理实例。居民可以拥有多个身体（跨 Bridge 灾备）。

### SafeEvolution
居民自主维护系统：修改提案 → 邻居验证 → 应用/回滚。要求 ≥2 个邻居验证。

---

## API

### Express API
端口 3001 的 REST 服务。15+ 路由模块，Bearer Token 认证。覆盖 agents、p2p、skills、updates、voice 等。

### 旧 HTTP API
端口 3000 的 HTTP 服务。Dashboard、WebSocket 聊天、信令、旧版兼容端点。已加鉴权。

---

## 独立模块

### fairy-guardian
npm 包 (`npm install fairy-guardian`)。自动守护 Ollama/vLLM 模型服务器。崩溃重启、滚动更新、零停机。零依赖，14KB。

---

## 已冻结

以下概念存在于代码中但不再推进：

| 术语 | 状态 | 说明 |
|------|------|------|
| NeuralMesh | 冻结 | FedAvg 原型，类定义未实例化 |
| NeuralBrain | 冻结 | 64→32→8 玩具 NN，概念验证 |
| Skill 市场 | 冻结 | P2P 知识共享的新方案待定 |
| 米兰币 | 未实现 | 虚拟货币，代币经济不在路线图 |
