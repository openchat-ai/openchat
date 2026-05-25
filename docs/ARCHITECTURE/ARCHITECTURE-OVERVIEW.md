# PeerTalk 架构总览

> **版本**: 3.0 | **更新时间**: 2026-05-25 | **状态**: Pre-alpha / 实验性

---

## 项目是什么

PeerTalk 是一个去中心化 P2P 语音通讯实验项目。手机通过七牛云 S3 直接交互，无需中央服务器。

| 目标 | 状态 | 说明 |
|------|------|------|
| P2P 实时语音通话 | **可用** | 基于 Qiniu Direct 架构：注册、信令、音频中继全部走 S3 |
| AI 居民系统 | **实验** | 6 个居民实体，基本思考循环，依赖外部 LLM API |
| SDUI 引擎 | **可用** | 远程 JSON 配置驱动 Flutter UI，无需发版改界面 |
| Debug 通道 | **可用** | 3 条命令（ping/diag/list_users），通过 Qiniu 文件交换 |

**不做的事情**：分布式大模型训练、区块链/代币、联邦学习。NeuralMesh/NeuralBrain 已移除。

---

## 系统架构

```
Phone A ──────→ Qiniu S3 ←────── Phone B
                   ↕ (optional)
              Bridge (AI residents, management)
```

### 核心架构决策：Qiniu Direct

Flutter 客户端直接与 Qiniu S3 通信，Bridge 是可选组件：

| 功能 | 传输方式 | Bridge 是否必需 |
|------|---------|---------------|
| 用户注册 | Phone ←→ Qiniu (S3 PUT) | ❌ 否 |
| 用户发现 | Phone ←→ Qiniu (S3 LIST) | ❌ 否 |
| 通话信令 | Phone ←→ Qiniu (S3 PUT/GET) | ❌ 否 |
| 音频中继 | Phone ←→ Qiniu (S3 PUT/GET) | ❌ 否 |
| AI 居民 | Bridge ←→ LLM API | ✅ 是 |
| SDUI 配置 | Phone ←→ Qiniu (S3 GET) | ❌ 否 |
| Debug 通道 | Phone ←→ Qiniu (S3 文件交换) | ❌ 否 |

### Bridge (Node.js)

运行在可选服务器上，提供 AI 居民管理和 LLM 集成：

```
Bridge (Node.js 24 ESM, Express)
├─ REST API (端口 3800)
│   ├─ GET /health              健康检查
│   ├─ GET /api-docs            Swagger 文档
│   ├─ /api/v1/agents           居民/Agent 管理
│   ├─ /api/v1/p2p              P2P 网络操作
│   ├─ /api/v1/voice            语音房间管理
│   └─ ... 其他路由
├─ WebSocket
│   ├─ /ws                      聊天协议
│   └─ /signaling               WebRTC 信令
├─ P2P 网络层 (hyperswarm)
│   ├─ DHT 节点发现
│   ├─ TCP 直连（局域网）
│   └─ 消息路由 + 优先级队列
├─ AI 居民系统 [实验]
│   ├─ resident-manager.js      居民 CRUD
│   ├─ resident-scheduler.js    思考循环 (tick → think → diary)
│   └─ 日记系统                 ~/.openchat/diaries/{id}.json
├─ provider-kit (LLM 统一 API)
│   └─ 42+ provider 适配器 (openrouter/free, OpenAI, Ollama...)
└─ fairy-guardian               模型服务器守护 (Ollama/vLLM)
```

### Flutter 客户端 (openchat-flutter)

APK 是主交互端。直接与 Qiniu S3 通信，Bridge 用于增强功能：

```
Flutter APK
├─ QiniuDirectClient          S3 PUT/GET/LIST 操作
├─ SDUI Engine                JSON→Widget 渲染
├─ Debug Channel              Qiniu 文件命令交换
├─ PeopleScreen               在线用户列表 + 呼叫
├─ VoiceRoomScreen            通话状态机 + 音频
├─ SettingsScreen             配置
└─ Audio Layer                record + audioplayers
```

---

## 各模块成熟度

### 可用 🟢

| 模块 | 说明 |
|------|------|
| Qiniu S3 通信 | PUT/GET/LIST 完整实现，AWS SigV4 认证 |
| UDP 打洞 | RawDatagramSocket 直连，25 次重试 |
| 通话状态机 | idle → calling → ringing → connected → idle |
| SDUI 引擎 | 远程 JSON 驱动 UI，文本/配置/布局 3 种类型 |
| Debug 通道 | ping/diag/list_users 3 条命令 |
| provider-kit | 42+ LLM provider，统一 chat() 接口 |
| fairy-guardian | 零依赖，14KB，自动重启/滚动更新 |

### 实验/原型 🔴

| 模块 | 现状 | 备注 |
|------|------|------|
| AI 居民系统 | 6 个居民实体，定时 tick → LLM 思考 → 写日记 | 无深度对话，无自发社交，mood 简单 |
| P2P 网络 | hyperswarm DHT 可发现，消息路由基础 | 跨 NAT 未验证，多跳路由未实战 |
| Bridge REST API | 路由框架完整 | 多数端点无真实数据源，返回 mock |
| 音频编解码 | 自研 104x 压缩 | 未在真实电话网络中验证 |

---

## 数据流

### 注册流程

```
Phone ── GET api.ipify.org (发现公网 IP)
     ── bind RawDatagramSocket (获取 UDP 端口)
     ── PUT oc/users/{peerId}.json → Qiniu S3
```

### 通话流程

```
Phone A                       Qiniu S3                       Phone B
  │                              │                              │
  ├─ PUT call-request ──────────→│                              │
  │                              ├─ LIST (B 轮询) ────────────→│
  │                              │←── PUT call-accept ─────────┤
  │←── LIST (A 轮询) ───────────┤                              │
  │                              │                              │
  ├── UDP hole punch ────────────┼────────────────────────────→│
  │  (25 次, 每 200ms)          │                              │
  │←── punch 收到 ──────────────┼──────────────────────────────┤
  │                              │                              │
  ├── UDP audio 直连 ────────────┼────────────────────────────→│
  │  (或 Qiniu relay fallback)  │                              │
```

### Debug 通道

```
Phone ←→ Qiniu S3 (oc/debug/{peerId}/cmd.json)
  → Phone 轮询命令文件
  → 执行 ping / diag / list_users
  → 写入结果到 oc/debug/{peerId}/resp.json
```

---

## 已移除的组件（R21 清理）

| 组件 | 文件 | 原因 |
|------|------|------|
| P2R 仙女系统 | fairies/ | 子进程复杂度 > 收益 |
| Convergence Engine | core/convergence/ | 从未实际运行 |
| Learning Core | core/evolution/learning-core.js | 基于规则，非真正学习 |
| EvolutionEngine | core/evolution/ | 字符串匹配冒充 AI |
| NeuralMesh | core/neural-mesh.js | 死代码，类定义未实例化 |
| Multi-Agent 角色 | agents/roles/ | agent-role-factory + 5 个角色 |
| 热更新系统 | updates/ | 过设计，无实际更新源 |
| Skill 市场 | 路由文件 | P2P 知识共享方案待定 |
| Dashboard | main.js HTML | 轮询式，被 Qiniu 架构取代 |

---

## 关键设计决策

1. **Qiniu Direct 优先** — 手机不依赖 Bridge。Bridge 只是 AI 居民的宿主，而非信令中继
2. **S3 作为总线** — 用户注册、信令、Debug 全部通过 Qiniu 文件交换。简单、可靠、无需服务器
3. **Edge 优先** — APK 是主交互端。Bridge 是可选增强
4. **SDUI 驱动 UI** — 不频繁发版。UI 文本、布局、行为通过远程 JSON 配置
5. **保持小体积** — 不做通用平台。只做一件事：P2P 语音。AI 居民是实验副产物

---

## 不做什么

- ❌ 分布式大模型训练 — 已确认不可行
- ❌ 区块链/代币 — 不在路线图
- ❌ 联邦学习 — NeuralMesh 已移除
- ❌ 人类社交功能 — PeerTalk 不是聊天 App
- ❌ 多平台发布 — 仅 Android APK，暂无 iOS

---

## 首次使用视角

**作为第一次使用的用户，当前最阻碍我的是什么：**

需要 Qiniu 账号 + bucket + 密钥才能运行。APK 内置凭据（私有项目可接受），但开源贡献者需要自建 S3 兼容存储。没有 5 分钟的"开箱即用"体验。

---

## 路线图

| 优先级 | 工作 | 说明 |
|--------|------|------|
| P0 | 去掉 Qiniu 硬依赖 | 支持本地测试模式 / 自建 S3 |
| P0 | 新人 onboarding 5 分钟 | 从 git clone 到第一次通话 ≤5 分钟 |
| P1 | AI 居民深度循环 | 日记有内容、mood 有变化、邻居有互动 |
| P1 | Bridge REST API 填真实数据 | 当前多数端点返回 mock 数据 |
| P2 | 音频编解码实战验证 | 在真实手机网络测试 104x 压缩 |
| P2 | P2P 消息路由加固 | 多跳、NAT 穿越、离线消息 |
