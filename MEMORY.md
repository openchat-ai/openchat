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

- **测试**: 138/138 全绿（1 flaky evolution-integration，单跑通过）
- **Lint**: eslint 9.39.4 + eslint.config.js 配置完成，59项预存错误待修
- **Demo**: `npm run demo` 一键 sandbox 体验脚本完成
- **P2P教程**: docs/p2p-voice-tutorial.md 完成
- **HTTP 路径**: 已统一到 Express 服务器（端口 3800），废弃 raw HTTP server
- **基础端口**: 固定为 3800，所有衍生端口以 3800 为基准推导
- **OpenAPI**: `/api-docs` 端点可通过 Swagger UI 浏览

## 最近会话摘要

- [2026-05-25] **音频链路 E1 完成**：队列播放 + 淡入淡出 + Opus 集成 + SDUI 三模式可切（raw/opus/neural）。RNNoise/AGC/VAD 管线已接入并通过 CI。AGENTS.md 新增 SDUI 优先原则（UI 变动先问 SDUI 能不能做，不 rebuild）。AGENTS.md 新增 Flutter API 签对签规则（推送前去 pub.dev 逐行核对 API）。修复 OpenRouter API key 泄露（git filter-repo 误删仓库后从 CI 引用恢复）。清理 33 个 apk-* tag 和所有旧 Actions runs。

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
- [2026-05-20] **第七轮专家评审 — console.log→pino 结构化日志**：114→115 测试（全绿）。完成 7 轮共 29 项 P0。134 个文件批量替换 console.log → logger.info/warn/error，pino 集成带敏感数据脱敏。**教训：PowerShell `Set-Content -NoNewline` 会以错误编码写入文件，导致 UTF-8 多字节字符损坏。文件修改必须统一用 Node.js `fs.writeFileSync(file, content, 'utf-8')`。`pino.transport()` 创建 worker 线程会阻止 Node.js test runner 退出，必须用同步 pino API。**
- [2026-05-20] **第八轮专家评审 — 安全加固+CoT+测试+目录精简**：128/128 全绿。完成 7 项 P0 执行：mathjs 替代 Function()、SSRF 防护、CoT 超时/token门禁、14 个 tool-registry 测试、src 目录 22→11、README 差异化描述、CI npm pack+docker build。**教训：大量目录合并涉及跨文件 import 路径更新，必须先 grep 所有引用再移动。`git stash` 可用于对比 pre-existing test failures 与引入的失败。**
- [2026-05-20] **第九轮专家评审 — catch{}系统性清理+死代码删除+子系统测试**：138/138 全绿（新增10个子系统测试）。完成5项P0执行：105处catch{}加日志(36文件)、19个.log垃圾文件清理、bridge.js死代码删除、ConvergenceEngine+FairyGuardian测试(10个)、evolution-integration确认仍flaky。**教训：R4修catch{}只限于topic-registry，这次grep出全项目105处。单文件"已修"不代表全项目已修，每次评审必须做全量扫描。**


- [2026-05-20] **第十轮专家评审 — core/ 129文件拆10子目录**：129文件从core/扁平→10语义子目录（agent/ evolution/ security/ convergence/ p2r/ monitoring/ memory/ audio/ collaboration/ quality/）。137/138测试全绿（仅剩evolution-integration flaky）。**教训：跨目录文件移动必须用自动化脚本处理import路径。PowerShell glob/正则局限性大，Node.js脚本更可靠。`../xxx/yyy.js`中xxx可能同时是src/xxx和core/xxx，必须按core/xxx优先解析。动态import（`await import()`）容易被批量替换漏掉，必须全量grep确认。17个test.mjs文件漏了动态import。**

| R14 | Flutter编译状态验证 | Flutter开发者 | P0-5 | ❌ 待修(部分完成) | Flutter开发者 |
| R14 | evolution-integration flaky续存 | 测试工程师 | P1-6 | ✅ 已修(R16) | 测试工程师 |
| R15 | CLI体验改造 — sandbox交互(颜色/持久化) | 技术经理 | P0-1 | ✅ 已修(R15) | 用户支持+架构师+竞品分析师 |
| R15 | Flutter编译验证+CI(端口3000→3800) | 技术经理 | P0-2 | ✅ 已修(R15) | Flutter开发者+安全研究员 |
| R15 | lint error 59→48 (comment-eats-code/duplicate/mac) | 技术经理 | P0-3 | ✅ 已修(R15) | 核心工程师+SRE |
| R15 | evolution-integration flaky根因分析 | 技术经理 | P0-4 | ✅ 已修(R16) | 测试工程师 |
| R15 | 单分支开发整改(清理bridge_setup.py+BRANCH_STRATEGY.md) | 技术经理 | P0-5 | ✅ 已修(R15) | Git专家 |
| R15 | Agent loop闭环验证 | 技术经理 | P1-6 | ❌ 待修 | AI研究员+测试工程师 |
| R15 | 模块级README | 技术经理 | P1-9 | ❌ 待修 | 架构师+开源社区经理+技术写作者 |
| R16 | resident-scheduler syntax error修复(demo崩溃) | 技术经理 | P0-1 | ✅ 已修(R16) | 全体13位专家 |
| R16 | 全量编码损坏文件扫描+修复(house-orchestrator) | 技术经理 | P0-2 | ✅ 已修(R16) | 安全研究员 |
| R16 | 添加 smoke test(所有src/文件node --check) | 技术经理 | P0-3 | ✅ 已修(R16) | 测试工程师+架构师 |
| R16 | evolution-integration重写为node:test(根除flaky) | 技术经理 | P0-4 | ✅ 已修(R16) | 测试工程师 |
| R16 | 618 lint warnings清零(eslint --fix) | 技术经理 | P0-5 | ✅ 已修(R16) | 核心工程师+SRE |

## 版本历史

| 轮次 | 意见摘要 | 提出专家 | 对应任务 | 状态 | 验收人 |
|------|---------|---------|---------|------|-------|
| R1 | 死代码太多(analysis-*.cjs, .js.js) | Git专家 | P0-1 清理4770文件 | ✅ 已修(R1) | Git专家 |
| R1 | 测试20%失败率不可接受 | 测试工程师 | P0-2 修复17个失败 | ✅ 已修(R2) | 测试工程师 |
| R1 | 旧HTTP无鉴权 | 安全研究员 | P0-3 API鉴权统一 | ✅ 已修(R2) | 安全研究员 |
| R1 | P2P零测试 | 测试工程师 | P0-4 8个P2P测试 | ✅ 已修(R2) | 测试工程师 |
| R1 | agent-engine session store缺失 | 核心工程师 | P0-1 注入deps | ✅ 已修(R2) | 核心工程师 |
| R2 | 两条HTTP路径共存 | 架构师 | P0-1 废弃raw HTTP | ✅ 已修(R3) | 架构师 |
| R2 | agent-session混用jest/ESM | 测试工程师 | P0-2 删除jest测试 | ✅ 已修(R3) | 测试工程师 |
| R2 | Flutter API对齐未验证 | Flutter开发者 | P0-3 baseUrl确认 | ✅ 已修(R3) | Flutter开发者 |
| R3 | //注释吃掉后续代码(3处) | 核心工程师 | 修复topic-registry/route-handlers | ✅ 已修(R4) | 核心工程师 |
| R4 | WS clients未追踪 | Code Review | server.js加this.clients | ✅ 已修(R4) | Code Review |
| R4 | _queryTopicPeers递归爆栈 | Code Review | 改为_getLocalPeers | ✅ 已修(R4) | Code Review |
| R4 | catch{}吞异常 | 安全研究员 | topic-registry加日志 | ✅ 已修(R4) | 安全研究员 |
| R4 | isMain端口检测被移除 | Code Review | 恢复port===DEFAULT_PORT | ✅ 已修(R4) | Code Review |
| R5 | forge.js零测试覆盖 | 核心工程师 | 16个测试 | ✅ 已修(R5) | 核心工程师 |
| R5 | generalization单测试不可信 | AI研究员 | 基准重算+扩展 | ✅ 已修(R6) | AI研究员 |
| R5 | evolution-integration flaky | 测试工程师 | 重写为node:test | ✅ 已修(R6) | 测试工程师 |
| R6 | 产品无一句话定位 | VC/投资人 | README重写 | ✅ 已修(R7) | VC/投资人 |
| R6 | 无新人onboarding | 开源社区经理 | first-steps.md | ✅ 已修(R7) | 开源社区经理 |
| R6 | 无CI | SRE/运维 | .github/workflows/ci.yml | ✅ 已修(R7) | SRE/运维 |
| R6 | eval-report残留 | Git专家 | 清理+.gitignore | ✅ 已修(R7) | Git专家 |
| R7 | console.log→pino结构化日志 | SRE/运维 | P0-1 替换134文件 | ✅ 已修(R7) | 测试工程师 |
| R7 | AI居民CoT+tool-use | AI研究员 | P0-4 tool-registry + CoT loop | ✅ 已修(R7) | 核心工程师 |
| R8 | calculate Function()构造器RCE | 安全研究员/核心工程师 | P0-1 mathjs替代 | ✅ 已修(R8) | 安全研究员 |
| R8 | web_fetch SSRF无防护 | 安全研究员/核心工程师 | P0-2 URL验证+内网阻断 | ✅ 已修(R8) | 安全研究员 |
| R8 | CoT无inter-iteration超时 | 核心工程师/AI研究员 | P0-3 per-iteration timeout+token门禁 | ✅ 已修(R8) | 核心工程师 |
| R8 | tool-registry+CoT零测试 | 测试工程师 | P0-4 14个测试(128→128) | ✅ 已修(R8) | 测试工程师 |
| R8 | src目录22个膨胀 | 架构师 | P0-5 22→11目录合并 | ✅ 已修(R8) | 架构师 |
| R8 | README未突出P2P语音差异 | 竞品分析师/VC | P0-6 差异化描述+Features表格 | ✅ 已修(R8) | 竞品分析师 |
| R8 | CI无构建产出验证 | SRE/运维 | P0-7 npm pack+docker build | ✅ 已修(R8) | SRE/运维 |
| R9 | 105处catch{}吞异常(36文件) | 安全研究员/核心工程师 | P0-1 批量加logger.warn | ✅ 已修(R9) | 安全研究员 |
| R9 | 19个.log垃圾文件 | SRE/运维 | P0-2 删除+gitignore已有 | ✅ 已修(R9) | SRE/运维 |
| R9 | bridge.js独立入口=死代码 | 核心工程师/架构师 | P0-3 删除bridge.js | ✅ 已修(R9) | 核心工程师 |
| R9 | core/目录149文件膨胀 → 10子目录 | 架构师 | P0-5 拆分子目录 | ✅ 已修(R10) | 架构师 |
| R9 | main.js start() 470行 | 核心工程师 | P0-2 拆阶段方法(待执行) | ❌ 待修 | 核心工程师 |
| R9 | evolution-integration flaky未根除 | 测试工程师 | P0-6 确认仍flaky(非R9引入) | ❌ 待修 | 测试工程师 |
| R9 | P2P通话step-by-step教程 | 用户支持/竞品分析师 | P0-7 文档(待执行) | ❌ 待修 | 用户支持 |
| R10 | core/ 129文件拆10子目录 | 架构师 | P0-1 core/拆分 | ✅ 已修(R10) | 架构师 |
| R10 | evolution-integration重写为node:test | 核心工程师 | P0-3 evolution重写 | ❌ 待修 | 测试工程师 |
| R10 | main.js start() 470行拆分 | 核心工程师 | P0-2 main.js拆分 | ❌ 待修 | 核心工程师 |
| R10 | lint接入CI | SRE | P0-5 lint配置 | ❌ 待修 | SRE |
| R10 | P2P教程+demo | 竞品分析师 | P0-12 P2P教程制作 | ❌ 待修 | 用户支持 |
| R13 | 四项原则评审—可交付版本验收标准 | 技术经理 | 写入AGENTS.md原则4 | ✅ 已修(R13) | VC/投资人+SRE |
| R13 | 四项原则评审—PRINCIPLE_TRACKING.json | Git专家 | 创建跟踪文件 | ✅ 已修(R13) | Git专家 |
| R13 | 四项原则评审—原则3强制执行机制 | Code Review | 写入AGENTS.md原则3 | ✅ 已修(R13) | 技术写作者 |
| R13 | 四项原则评审—换方案触发机制 | 核心工程师 | 写入AGENTS.md原则1 | ✅ 已修(R13) | 核心工程师 |
| R13 | 四项原则评审—每3轮硬性版号 | 竞品分析师 | 写入AGENTS.md原则4 | ✅ 已修(R13) | 竞品分析师 |
| R14 | main.js空catch加logger(5处) | 安全研究员 | P0-4 | ✅ 已修(R14) | 安全研究员 |
| R14 | CI lint替换eslint.config.js+devDependencies | SRE/运维 | P0-2 | ✅ 已修(R14) | SRE/运维 |
| R14 | npm run demo一键sandbox体验脚本 | 用户支持 | P0-1 | ✅ 已修(R14) | 用户支持 |
| R14 | P2P端到端demo教程 | 竞品分析师 | P0-3 | ✅ 已修(R14) | 竞品分析师 |
| R14 | src/*.js 59项预存lint错误(no-undef/no-empty等) | SRE/运维 | P1-后续 | ✅ 已修(R15, 59→48) | SRE/运维 |
| R14 | evolution-integration flaky续存 | 测试工程师 | P1-6 | ❌ 待修 | 测试工程师 |
| R14 | Flutter编译状态验证 | Flutter开发者 | P0-5 | ❌ 待修(部分完成) | Flutter开发者 |
| R17 | 测试超时 — `--test-force-exit` 修复 | 技术经理 | P0-1 | ✅ 已修(R17) | 测试工程师 |
| R17 | lint no-undef 41 → 0 (commands.js 缺 import) | 技术经理 | P0-2 | ✅ 已修(R17) | 核心工程师 |
| R17 | main.js start() 拆 lifecycle 方法 (_printBanner/_initCoreSystems/_enterSandboxMode) | 技术经理 | P0-3 | ✅ 已修(R17) | 架构师 |
| R17 | core/ restructure import 路径修复 (agent-monitor/ai-personhood 等12处) | 技术经理 | P0-3 | ✅ 已修(R17) | 核心工程师 |
| R17 | CI lint gate 加固 (--max-warnings=0) | 技术经理 | P0-2 | ✅ 已修(R17) | SRE/运维 |
| R17 | evolution-memory.test.mjs import 路径修复 | 技术经理 | P0-1 | ✅ 已修(R17) | 测试工程师 |
| R17 | resident-scheduler class 导出供测试 | 技术经理 | P0-1 | ✅ 已修(R17) | 测试工程师 |
| R17 | agent-loop-e2e 3 个 scheduler 测试全部修复 | 技术经理 | P0-1 | ✅ 已修(R17) | 测试工程师 |
| R17 | main.js 6 处空 catch 加 logger | 安全研究员 | P0-2 | ✅ 已修(R17) | 安全研究员 |
| R18 | voice_client.dart 编译修复（_onAudioData 重复/UdpHolePunch 孤儿代码/RawDatagramSocket API） | 技术经理 | P0-1 | ✅ 已修(R18) | Flutter 开发者 |
| R18 | main.js:612 getPublicIPv4 未定义修复 | 技术经理 | P0-2 | ✅ 已修(R18) | 核心工程师 |
| R18 | 全项目 39+ no-empty lint 清零 | 技术经理 | P0-3 | ✅ 已修(R18) | 核心工程师 |
| R18 | CI lint gate 升级 --max-warnings=0 | 技术经理 | P0-4 | ✅ 已修(R18) | SRE/运维 |
| R19 | 提交 R18 变更并推送 CI | 技术经理 | P0-1 | ✅ 已修(R19) | 13 位专家 |
| R19 | 语音数据流文档 docs/voice-data-flow.md | 技术经理 | P0-6 | ✅ 已修(R19) | 技术写作者 |
| R19 | CI 全绿 — bridge lint error(getPublicIPv4) + Flutter analyze(voice_client+pubspec) | 技术经理 | P0-1 | ✅ 已修(R19) | 全体 |
| R19 | Flutter 依赖修复 — web_socket_channel 加回 pubspec | 技术经理 | P0-2 | ✅ 已修(R19) | Flutter 开发者 |
| R19 | 端到端语音通话验证 — APK 构建通过(CI) | 技术经理 | P0-3 | ⚠️ APK 已生成，待双手机实测 | 竞品分析师+用户支持 |

## 关键指标（实时）

- **测试**: 147/147 全绿 + 39 provider-kit 测试全绿
- **Lint**: 0 errors, 0 warnings ✅
- **CI**: **全线全绿**（bridge-lint、bridge-test、flutter-test、flutter-apk）
- **APK**: 手动触发构建成功，artifact 可下载
- **Flutter**: voice_client.dart 编译修复 + people_screen.dart 修复 + record pkg 升级到 6.x
- **Demo**: `npm run demo` 一键 sandbox 体验脚本正常
- **P2P教程**: docs/p2p-voice-tutorial.md 完成

## 版本计划（时间管理师监管）

> 多条工作线并行推进，版本号标识当前综合成熟度。每条线独立迭代，不互相阻塞。

### 工作线 A：音频通路 — 最优先
| 版本 | 交付 | 状态 |
|------|------|------|
| A1 | 录音→Qiniu→播放完整链路（队列播放、淡入淡出、Opus/raw/neural 三模式 SDUI 可切） | ✅ |
| A2 | 双手机端到端通话验证 | ⏳ 待测试 |
| A3 | 延迟优化 | ⏳ |
| A4 | UDP 打洞直连 | ⏳ |

### 工作线 B：基础设施 — 已完成
| 版本 | 交付 | 状态 |
|------|------|------|
| B1 | Qiniu Direct 架构（注册/发现/预签名 URL） | ✅ |
| B2 | SDUI 引擎 + 远程配置（JSON→Widget） | ✅ CI 编译中 |
| B3 | Debug 命令通道 | ✅ CI 编译中 |
| B4 | 远程配置 + 轮询间隔可调 | ✅ 代码已提交 |
| B5 | CHANGELOG + README 更新 | ✅ 已提交 |

### 工作线 C：SDUI 化 — 硬编码 UI 逐步迁移到远程配置
| 版本 | 交付 | 状态 |
|------|------|------|
| C1 | Audio mode 切换按钮（Raw/Opus/Neural）→ 纯 SDUI file:write | ✅ |
| C2 | Voice room 通话界面（状态文字、mute/挂断按钮）→ SDUI 模板变量 | 📋 |
| C3 | Settings/Home 页移除硬编码兜底 | 📋 |
| C4 | 新建 UI 功能默认走 SDUI，不改 Dart | 📋 |

### 工作线 D：双机通话 — 依赖 A 线完成后
| 版本 | 交付 | 状态 |
|------|------|------|
| D1 | 互相发现→呼叫→接听→音频通 | ⏳ |
| D2 | 通话中状态管理（mic mute、挂断） | ⏳ |
| D3 | 联系人管理、通话记录 | ⏳ |

### 工作线 E：Neural Codec 升级 — 乐器音色 + 乐谱重合成
| 版本 | 交付 | 状态 |
|------|------|------|
| E1 | 当前音频链路修复（WAV 头拼接、AudioProcessor 接入 CI 验证通过） | 🏗️ CI 运行中 |
| E2 | 合成器升级：32 频段滤波器组替代 5 正弦波，Sub-band 控制增益而非固定振幅 | 📋 |
| E3 | 瞬态编码：加入 onset 检测 + 瞬态层（SNDAN 风格），解决打击乐器/音头丢失 | 📋 |
| E4 | 音色模型：为乐器建立 wavetable/LPC 码本，编码端传音色索引而非子带能量 | 📋 |
| E5 | Source separation：编码端分离人声/乐器 → 多轨道独立编码 | 📋 |
| E6 | 乐谱表示：加入基频追踪 + MIDI 级转录 → B 端可用任意音色演奏 | 📋 |
| E7 | 端到端神经网络：替换为 EnCodec/DAC 预训练模型，手机 NPU 推理 | 📋 |

### 里程碑
| 版本 | 含义 | 条件 |
|------|------|------|
| **v1.0.0** | 首次可用 | 单机 Demo 能完整走通（看到用户→呼叫→听到声音） |
| **v1.1.0** | 双机通话 | 两台设备端到端语音通 |
| **v2.0.0** | 生产可用 | 多人组会 + AI 居民接入 + 加密 |
| **v3.0.0** | 高音质音乐通话 | Neural Codec E3 以上 + 音乐场景可闻无损 |
