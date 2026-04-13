# MEMORY.md — 项目记忆

## 经验教训

- [2026-04-11] LLM API 连接优先使用 OpenAI 兼容格式（如硅基流动的 `/v1/chat/completions`）
- [2026-04-11] Ollama Cloud API 端点是 `https://ollama.com/api`（无需 `/v1` 后缀），但需要账号额度
- [2026-04-11] 混沌工程测试必须配合错误恢复策略系统才能真正提升韧性
- [2026-04-11] Property-Based Testing 能发现人工难以想到的边缘崩溃案例
- [2026-04-11] Agent 自检闭环是"Think-Act-Verify-Refine"的真正实现
- [2026-04-11] 测试用例扩充后平均分从 4.67 提升到 4.88，覆盖更全面

## 最近会话摘要

- [2026-04-11] **重大突破**：为 OpenChat Bridge 构建了完整的 AI Agent 测试框架
- [2026-04-11] 实现了 Agent 自检闭环 - Agent 可主动调用 `run_llm_judge` 进行质量自检
- [2026-04-11] 增强了 PluginManager - 参数验证 + 别名规范化 + 容错执行
- [2026-04-11] **最终测试结果**：LLM评测 4.88/5，混沌韧性 100%，回归测试 100% - 全部达标
- [2026-04-11] 测试用例从 3 个扩充到 8 个，覆盖更全面
- [2026-04-11] 完成部署演示，验证了真实对话场景中的自检闭环

## 主题文件路由表

> 涉及以下领域时读取对应文件

| 触发词 | 文件 | 说明 |
|--------|------|------|
| 核心逻辑 | memory/core-logic.md | 核心业务逻辑 |
| 调试经验 | memory/debugging.md | 调试经验、常见 bug |
| 测试框架 | bridge/test-utils/ | AI Agent 测试套件 |
| 自检闭环 | bridge/src/core/agent-engine.js | Agent Think-Act-Verify 循环 |
| 错误恢复 | bridge/src/plugins/error-recovery.js | 7 种故障恢复策略 |

## 开放线程

<!-- 格式：- [YYYY-MM-DD] 未完成的工作项 -->

- [2026-04-11] ~~扩充测试用例库~~ ✅ 已完成
- [2026-04-11] ~~部署与实际应用~~ ✅ 已完成
- [2026-04-13] ~~Phase 1: 指令简化（NaturalLanguageParser）~~ ✅ 已完成
- [2026-04-13] ~~Phase 2: 持久记忆（~/.openchat/ 配置存储）~~ ✅ 已完成
- [2026-04-13] ~~Phase 3: Multi-Agent 基础~~ ✅ 已完成
- [2026-04-13] ~~Phase 4: Agent 通讯 (sendTo/broadcast/delegate)~~ ✅ 已完成
- [2026-04-13] ~~Phase 5: 并行执行 (Promise.all 调度)~~ ✅ 已完成

## 项目状态快照

### OpenChat Bridge 测试框架

**文件结构：**
```
bridge/
├── test-utils/
│   ├── llm-judge.js          # LLM-as-a-Judge 评测引擎
│   ├── chaos-test.js          # 混沌工程测试
│   ├── property-test.js       # 属性测试 (FastCheck)
│   ├── replay-test.js        # 回归测试回放
│   ├── llm-integration.js     # LLM 集成（支持多provider）
│   ├── siliconflow-integration.js  # 硅基流动 API
│   ├── deepseek-integration.js    # DeepSeek API
│   ├── ollama-integration.js      # Ollama API
│   └── groq-integration.js        # Groq API
├── src/
│   ├── core/
│   │   ├── natural-language-parser.js  # 自然语言指令解析 ✅ Phase 1
│   │   ├── multi-agent-coordinator.js  # 多 Agent 协调器 ✅ Phase 3
│   │   ├── agent-session.js       # Agent 会话管理 ✅ Phase 3
│   │   ├── message-bus.js         # Agent 消息总线 ✅ Phase 3
│   │   ├── agent-engine.js       # Agent 推理引擎
│   │   ├── handlers.js           # 核心处理器
│   │   ├── prompt-builder.js     # Prompt 构建器
│   │   └── router.js             # 消息路由
│   ├── cli/
│   │   ├── commands.js           # CLI 命令处理（已集成NLP + Multi-Agent）
│   │   └── auto-detect.js        # AI 工具自动检测
│   ├── memory/
│   │   └── persistent-config.js  # 持久配置存储 ✅ Phase 2
│   └── plugins/
│       ├── error-recovery.js     # 错误恢复策略系统
│       ├── plugin-manager.js      # 增强的插件管理器
│       ├── self-test-plugin.js    # 自检工具插件
│       └── eng-plugins.js        # Git/DevTools 插件
├── deployment-demo.js           # 部署演示脚本
└── generate-report.js         # 测试报告生成器
```

**配置存储 (~/.openchat/)：**
```
~/.openchat/
├── config.json      # API Keys (AES-256-CBC 加密)
├── memory/          # 记忆文件
├── skills/          # 自定义技能
└── sessions/       # 会话历史
```

**自然语言命令支持：**
```
  我用 openai <key>              使用 OpenAI provider
  我用 claude                     使用 Claude provider  
  我用 deepseek <key>            使用 DeepSeek provider
  配置 openai <key>               存储 API key 到 ~/.openchat/
  记住我喜欢用 qwen               记住用户偏好
  列出提供商                      列出已配置的 providers
  新建会话                        创建新会话
  帮助 / 状态 / 退出              快捷命令
```

**测试命令：**
```bash
npm run test:llm-judge    # LLM 智能评测
npm run test:chaos        # 混沌工程测试
npm run test:property     # 属性测试
npm run test:replay       # 回归回放测试
node generate-report.js   # 生成完整报告
node deployment-demo.js   # 运行部署演示
```

**API 配置 (.env)：**
```
SILICONFLOW_API_KEY=sk-szqoqmlrhsxggjlwmaubulnbnntoxdesfjwgrpswuxygtwhk
SILICONFLOW_MODEL=Qwen/Qwen2.5-72B-Instruct
USE_SILICONFLOW=true
```

**当前评分：**
| 维度 | 得分 | 等级 |
|------|------|------|
| LLM 评测 | 4.88/5 | 🟢 优秀 |
| 混沌韧性 | 100% | 🟢 EXCELLENT |
| 回归测试 | 100% | 🟢 PASS |

**测试用例 (8个)：**
1. file-creation - 文件创建与验证
2. git-operation - Git 基础操作
3. error-recovery - 错误恢复测试
4. multi-tool-collaboration - 多工具协作场景
5. code-review - 代码审查场景
6. data-processing - 数据处理场景
7. api-call - API 调用场景
8. complex-logic - 复杂逻辑场景

**Agent 自检闭环流程：**
```
用户请求 → Agent执行(write_file/run_command) → Agent自检(run_llm_judge)
    ↓ (score < 4)
自我优化 → 再次验证 → 交付结果
```

**错误恢复策略 (7种)：**
1. disk-cleanup - 磁盘满时清理
2. git-remote-recovery - Git权限错误时检查认证
3. timeout-recovery - 超时时重试
4. permission-fix - 权限不足时尝试修复
5. file-recovery - 文件不存在时创建/查找
6. retry-with-backoff - 随机失败时指数退避重试
7. generic-recovery - 未知错误通用恢复