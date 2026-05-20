# OpenChat

Self-hosted **P2P voice chat** with AI residents that learn from each other. Run your own decentralized voice community — your server, your rules, your AI. No cloud dependency, no data leaving your cluster.

> 🎯 **What makes OpenChat different**: Most voice chat apps route audio through a central server. OpenChat establishes **direct P2P WebRTC connections** between users after lightweight signaling — zero voice data ever touches your server. Combined with built-in **RNNoise voice enhancement** and **neural audio codec**, you get crystal-clear low-latency calls that scale horizontally: each new user adds bandwidth, not subtracts it.

```
npm packages:    provider-kit (42 LLM providers), fairy-guardian (self-healing clusters)
Bridge server:   agent-engine + P2P messaging + WebSocket
Flutter client:  mobile chat (WIP)
```

## Features

| | |
|---|---|
| 🎙️ **P2P Voice** | Direct WebRTC between peers after DHT signaling — no voice data through server |
| 🤖 **AI Residents** | Persistent AI agents with memory, CoT reasoning, and tool use |
| 🧠 **Distributed Memory** | Knowledge learned by one resident gossips across the P2P network |
| 🔒 **Self-hosted** | Zero cloud dependency. Full data control. No telemetry. |
| 🌐 **42 LLM Providers** | OpenAI, Anthropic, SiliconFlow, Ollama, and 38 more |
| 🔧 **Self-healing** | fairy-guardian handles crashes, hot-reloads config changes |
| 📱 **Mobile Client** | Flutter app with WebRTC voice (Android/iOS/Linux/Mac/Windows) |

> 🖼️ **Demo**: [P2P voice call demo GIF](https://example.com/demo.gif) — _Coming soon_

## Architecture

```
           ┌─────────────────────┐
           │   Flutter Client    │
           │  (openchat-flutter/) │
           └────────┬────────────┘
                    │ WebSocket
           ┌────────▼────────────┐
           │     Bridge Server   │
           │    (bridge/src/)    │
           │                     │
           │  ┌───────────────┐  │
           │  │ agent-engine  │  │ Think-Act-Verify loop
           │  │ EvolutionMem │  │ Persistent memory
           │  │ Resident Mgr │  │ Resident lifecycle
           │  └──────┬───────┘  │
           │         │          │
           │  ┌──────▼───────┐  │
           │  │ provider-kit  │  │ 42 LLM providers
           │  │ fairy-guardian│  │ Process self-healing
           │  └──────────────┘  │
           └────────────────────┘
```

## Quick Start (6 steps)

```bash
# 第 1 步：克隆
git clone https://github.com/openchat-ai/openchat.git
cd openchat

# 第 2 步：配置环境变量
cd bridge
cp .env.example .env
# 编辑 .env，填入至少一个 LLM API Key（支持 42 家供应商）
# 推荐: SILICONFLOW_API_KEY=sk-xxx（国内直连，无需代理）

# 第 3 步：安装依赖
npm install

# 第 4 步：启动 Bridge
npm start              # → HTTP: localhost:3800, WS: /ws, Signaling: /signaling
```

### 第 5 步：验证

| 入口 | 地址 |
|------|------|
| Dashboard | http://localhost:3800 |
| API 文档 | http://localhost:3800/api-docs |
| 健康检查 | http://localhost:3800/health |
| WebSocket | ws://localhost:3800/ws |
| 信令 WebSocket | ws://localhost:3800/signaling |

### 第 6 步：运行测试

```bash
npm test                # 120 tests (core + P2P + benchmarks)
npm run test:all        # 全部测试含 contract（需运行 Bridge）
npm run test:watch      # 文件监听模式
```

### （可选）Flutter 客户端

```bash
cd openchat-flutter
flutter pub get
flutter run            # 连接 localhost:3800
```

## Project Map

| 目录 | 内容 |
|------|------|
| `bridge/` | 后端服务器（Node.js 24 ESM） |
| `openchat-flutter/` | 移动端（Flutter 3.11+） |
| `modules/provider-kit/` | LLM 供应商统一接口（已发布 npm） |
| `modules/fairy-guardian/` | 自愈进程集群（已发布 npm） |
| `docs/` | 架构图、开发规范、部署方案 |
| `CHANGELOG.md` | 版本更新记录 |
| `ROADMAP.md` | 开发路线图 |

## Packages

| Package | Description | npm | GitHub |
|---------|-------------|-----|--------|
| `provider-kit` | 42 LLM provider unified API | [npm](https://npmjs.com/package/provider-kit) | [GitHub](https://github.com/openchat-ai/provider-kit) |
| `fairy-guardian` | Self-healing process cluster | [npm](https://npmjs.com/package/fairy-guardian) | [GitHub](https://github.com/openchat-ai/fairy-guardian) |

## Status

This is an active work-in-progress. The core infrastructure (LLM gateway, agent loop, memory, P2P) is functional. The Flutter mobile client and resident conversation UI are under development.

## License

MIT
