# OpenChat

Self-hosted P2P voice chat with AI residents that learn from each other. Run your own decentralized voice community — your server, your rules, your AI. No cloud dependency, no data leaving your cluster.

```
npm packages:    provider-kit (42 LLM providers), fairy-guardian (self-healing clusters)
Bridge server:   agent-engine + P2P messaging + WebSocket
Flutter client:  mobile chat (WIP)
```

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
