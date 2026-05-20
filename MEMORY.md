# MEMORY.md — 项目记忆

## 经验教训

- [2026-05-16] **文档与代码严重脱节** — ARCHITECTURE-OVERVIEW 描述的"全球 AI 智能体网络"与实际代码差距巨大。已重写为诚实版本，标注每个模块的真实成熟度。**教训：文档必须根植于可运行的代码，不能超前描述不存在的能力。**
- [2026-05-16] **NeuralMesh 从未被实例化** — 类定义了但零引用，是死代码。neural_share 消息在 swarm.js 中未路由（已修）。**教训：写完模块必须写集成代码，否则等于没写。**
- [2026-05-16] **旧 HTTP 服务器 (端口 3800) 零鉴权运行数月** — `/shutdown`、`/api/chat`、`/api/config` 等敏感端点无任何保护。已加 Bearer Token 鉴权。**教训：两条 API 路径必须统一安全管理。**
- [2026-05-16] **P2P 权重接收无数据验证** — 可投毒 NaN/Infinity/超大数组。已加 validateWeights() 和 sanitizePeerId()。**教训：所有来自网络的输入必须验证，无一例外。**
- [2026-05-16] 测试 ESM/CJS 混用导致 import 失败 — `package.json` 声明 `"type": "module"` 但某些测试文件使用 CJS 风格 import。统一 ESM，不要混用。
- [2026-05-16] bridge 根目录散落 12 个 .cjs 一次性修复脚本 — 已移到 `bridge/scripts/migrations/`，以后此类脚本直接放 scripts/。
- [2026-05-16] `app/` 是废弃旧版 Flutter 项目，已删除。唯一前端是 `openchat-flutter/`。

## 关键指标（实时）

- **测试**: 120/120 全部通过（2026-05-20 首次达成）
- **HTTP 路径**: 已统一到 Express 服务器（端口 3800），废弃 raw HTTP server
- **基础端口**: 固定为 3800，所有衍生端口以 3800 为基准推导
- **OpenAPI**: `/api-docs` 端点可通过 Swagger UI 浏览

## 最近会话摘要

- [2026-05-16] **项目定位大讨论**：通过多角色审视（VC、安全研究员、贡献者、核心工程师、Petals 开发者、考古学家、学生用户、记者、Flutter App 视角）确认项目真实竞争力在 P2P 语音通讯，而非分布式大模型。AI 居民社区方向保留但标注为实验。
- [2026-05-16] **安全加固**：修复 neural-mesh.js 权重验证+路径穿越、swarm.js neural_share 路由、main.js 旧 HTTP 鉴权。
- [2026-05-16] **文档大修**：重写 ARCHITECTURE-OVERVIEW.md、docs/README.md、GLOSSARY.md，与代码真实状态对齐。
- [2026-05-16] 项目审核：发现并修复 AGENTS.md 空文件、MEMORY.md 空文件、测试 ESM 问题、清理废弃 `app/` 目录。

## 主题文件路由表

> 涉及以下领域时读取对应文件

| 触发词 | 文件 | 说明 |
|--------|------|------|
| Bridge/后端/main.js | memory/core-logic.md | Bridge 核心启动流程、配置加载、模块初始化 |
| P2P/DHT/节点发现 | memory/p2p.md | hyperswarm P2P 网络、节点发现、消息路由 |
| Agent/代理/多AI | memory/agents.md | 5 种代理角色、反馈聚合、决策系统 |
| 热更新/Watchdog | memory/hot-update.md | SafeEvolution、热更新流程、回滚机制 |
| API/REST/端点 | memory/api.md | 31 个 API 端点、认证、限流 |
| Flutter/客户端/UI | memory/flutter.md | openchat-flutter 架构、API Client 层 |
| 语音/音频/WebRTC | memory/audio.md | RNNoise、神经编解码、语音网关 |
| 调试经验 | memory/debugging.md | 常见 bug、调试技巧 |

## 开放线程

- [2026-05-18] **泛化引擎已实现** — generalization.js (300行) + 集成到 resident-manager think() 流程。当用户提问时：vector memory 搜相关经验 → generalization 分析模式 → LLM 生成多解法 → 回存知识库 → gossip 同步全网。实现了"一次查询，所有居民复用"的闭环。
- [2026-05-18] AI 居民内部循环 — 已完整链路：状态机 + 能量系统 + vector memory + generalization + gossip。think() 不再是裸 LLM 调用。
- [2026-05-16] Dashboard 实时推送 — 后端状态变化需要通过 WebSocket 推送到前端，而非前端轮询。
- [2026-05-18] `bridge/src/main.js` 已从 ~1900 行拆至 26 行（死代码清理后），但 MEMORY.md 和 MAINJS_REFACTOR_PLAN.md 保留旧数据导致专家评审反复吃假粮。**教训：文档中的数字指标必须在代码变更后立即同步更新，否则自动摘要工具会重复传播过期信息。**
- [2026-05-18] `protocol/README.md` 存在（265 行协议文档），之前误记为空目录。已保留。
- [2026-05-18] 四轮专家评审共执行 24 项 P0，Bridge 根目录清理 12 个 Python 遗留文件，AI 居民状态机+多路径推理替换预制回答。**教训：专家评审每轮都套用相同提问模式——架构/测试/安全/AI——不会问完全重复的问题。当评审开始聚焦"居民不够聪明"和"知识不共享"时，说明基础设施债已还完，轮到产品力了。**

- [2026-05-20] **第五轮专家评审 — HTTP 路径统一 + 首次全绿**：测试从 98/98 推进到 120/120（第五轮 98→第六轮 120，最终全绿）。完成 5 项 P0 执行：Express 监听端口 3800，废弃 raw HTTP server，所有衍生端口以 3800 为基准。**教训：大量遗留代码（startServer 中的 ~250 行路由/WebSocket 逻辑）在首次 edit 时未完全匹配删除，因文件行号已因前序 edit 偏移。大段替换时必须用唯一匹配锚点（如 `}` + 下一方法签名）。**
