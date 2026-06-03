# 三个开源项目研究报告

**日期**: 2026-06-03
**目标项目**: omp / forge / rtk
**调研目的**: 评估对 openchat bridge 的借鉴价值

---

## 1. oh-my-pi (can1357) — 终端 AI 编程 Agent

**仓库**: github.com/can1357/oh-my-pi | **10k stars / 831 forks** | **v15.8.0 (2026-06-02)** | MIT

**身份**: Mario Zechner 的 [Pi](https://github.com/badlogic/pi-mono) 的 fork,"batteries included" 的终端编程 Agent。Rust 内核 + TypeScript/Bun 外壳 + N-API 绑定。

### 关键设计

- **Hashline 编辑**: 模型用内容哈希定位锚点,不重打原文。Grok 4 Fast 同一任务 **-61% 输出 token**。
- **18 个核心特性** (来自 README): LSP 接入、真实 DAP 调试器 (lldb/dlv/debugpy)、Python+JS 双 kernel 互相调用、`eval` 持久会话、subagent schema 校验返回、time-traveling stream rules (规则注入 + 重试)、Hindsight 长期记忆、`omp commit` 原子化拆分 commit、conflict://、ast_edit 预览-接受、原生 Windows (无 WSL)
- **~27k 行 Rust 干别人 shell out 的活**: shell (3.7k)、grep (1.9k)、ast_grep (1k)、summarize tree-sitter (1k)、fs_cache、pty、tokens (tiktoken-rs)、html→md、image 解码。所有在 libuv 线程池内,零 fork/exec
- **40+ provider, 5 种 role**: default / smol (subagent fan-out) / slow (deep reasoning) / plan / commit
- **Four entry points**: TUI / `-p` 一次性 / RPC stdio / ACP (Agent Client Protocol, 给 Zed 用)
- **导入 8 种已有规则的格式**: Cursor MDC, Cline .clinerules, Codex AGENTS.md, Copilot applyTo, .claude, .windsurf, .gemini, .codex

### 性能数字 (来自 omp.sh/blog)

| model | metric | what |
|-------|--------|------|
| Grok Code Fast 1 | 6.7% → 68.3% | 改 edit format 后十倍提升 |
| Gemini 3 Flash | +5 pp | 超过 str_replace |
| Grok 4 Fast | −61% tokens | 失败 diff 重试循环消失后输出塌缩 |
| Claude Haiku | 2.1× | pass rate 翻倍 |

### 值得借鉴的点

- Hashline 是 token 节省的"内容层"解法,比 prompt 优化更稳定
- DAP 真接调试器是 OpenCode 当前没有的
- 4 个 entry point 同一个引擎 = SDK 友好
- "继承现有规则" 是 onboarding 杀手锏

---

## 2. forge (antoinezambelli) — 自托管 LLM 工具调用可靠性层

**仓库**: github.com/antoinezambelli/forge | **2k stars / 138 forks** | **v0.7.3 (2026-06-01)** | MIT + IEEE 论文

**身份**: 单一职责 — 让本地小模型 (8B) 的 tool calling 从个位数正确率拉到 84%。**不是 agent orchestrator, 不是 coding harness**。

### 核心机制 (proxy 模式, 主流入口)

1. **Response validation** — 检查 tool 名/参数合法性,在响应返回客户端前拦截
2. **Rescue parsing** — 模型输出格式错误时(Mistral `[TOOL_CALLS]`、Qwen `<tool_call>` XML、code fence 里的 JSON),自动提取并 re-emit 成 OpenAI `tool_calls` schema
3. **Retry with nudge** — 失败时注入修正 message 重试 (默认 3 次)
4. **Synthetic respond tool** — 当请求带 tools 时,注入一个 synthetic `respond` tool,强制模型用它代替裸文本,响应中再 strip 掉。**对 ~8B 模型必备**

### 三种用法

- **Proxy server** (`python -m forge.proxy`): OpenAI/Anthropic 协议, drop-in 替换本地模型
- **WorkflowRunner**: 全生命周期管理,system prompt + tool 执行 + 上下文压缩
- **Guardrails middleware**: 在自己编排循环里只挂 forge 的校验/重试

### 性能数字

- 8B 本地模型 26 场景 eval 从个位数到 84%
- Sonnet 4.6 从 85% → 98% (v0.6.0 测的, v0.7.0 没重测因为贵)

### 数据

- 865 单元测试 (deterministic, 无需 LLM)
- 26 场景 eval harness (OG-18 + advanced_reasoning 8)
- 支持 backend: Ollama / llama-server / Llamafile / vLLM / Anthropic

### 对 openchat 的相关点

如果未来想支持本地 8B 模型(省钱/离线),forge 是唯一能用的 proxy 层。

---

## 3. rtk (rtk-ai) — CLI 输出 token 压缩器

**仓库**: github.com/rtk-ai/rtk | **58k stars / 3.6k forks** | **v0.42.0 (2026-05-24)** | Apache 2.0

**身份**: 单个 Rust 二进制,透明拦截 shell 命令,过滤输出到 LLM。**-80% token** (30 分钟 Claude Code 会话 11.8万 → 2.39万 token)。

### 4 策略

智能过滤 / 分组聚合 / 截断 / 去重

### 覆盖 100+ 命令

git (12 子命令)、cargo test (NDJSON)、jest/vitest/pytest (失败优先)、eslint/ruff/golangci-lint (按 rule 分组)、docker/kubectl (去重日志)、aws (strip policy/secrets)、pnpm/pip/bundle (compact tree)

### 杀手特性 — Auto-rewrite Hook

`rtk init -g` 安装 hook,把所有 `git status` 改写为 `rtk git status`。覆盖 **14 个 AI 工具** (Claude Code, Copilot, Cursor, Gemini CLI, Codex, Windsurf, Cline, OpenCode, Pi, Hermes, Antigravity, Kilo, Mistral Vibe)。**对 OpenCode 直接有 plugin** (`rtk init -g --opencode`)。

### Token 分析

- `rtk gain` / `rtk gain --graph` / `rtk discover`(找未优化命令)/ `rtk session`
- `tee` 模式: 失败时保留原始输出到 `~/.local/share/rtk/tee/`,LLM 可读不重跑

### Token savings 数字 (30 分钟 Claude Code 会话)

| 操作 | 频率 | 标准 | rtk | 节省 |
|------|------|------|-----|------|
| ls / tree | 10x | 2,000 | 400 | -80% |
| cat / read | 20x | 40,000 | 12,000 | -70% |
| grep / rg | 8x | 16,000 | 3,200 | -80% |
| git status | 10x | 3,000 | 600 | -80% |
| git diff | 5x | 10,000 | 2,500 | -75% |
| git log | 5x | 2,500 | 500 | -80% |
| cargo test | 5x | 25,000 | 2,500 | -90% |
| ruff check | 3x | 3,000 | 600 | -80% |
| docker ps | 3x | 900 | 180 | -80% |
| **Total** | — | **~118,000** | **~23,900** | **-80%** |

### 对 openchat 的相关点

bridge 的 OpenCode 部分, Bash tool 输出如果接 rtk,token 可降 60-90%。但前提是 rtk hook 能接到 OpenCode 的 `tool.execute.before`。

---

## 对比表

| 维度 | oh-my-pi | forge | rtk |
|------|----------|-------|-----|
| 定位 | 完整编程 Agent | 工具调用可靠性层 | CLI 输出过滤器 |
| 语言 | Rust + TS | Python | Rust |
| 规模 | 27k Rust LoC + TS SDK | ~865 测试 + 26 场景 eval | 单二进制, <10ms |
| 模型假设 | 多 provider 大模型 | 本地 8B 起 | 模型无关 |
| 关键指标 | edit 一次成功率 +61% | 8B 单→84%, Sonnet 85→98% | token -80% |
| 协议 | TUI/RPC/ACP/SDK | OpenAI + Anthropic proxy | shell wrapper |
| Stars | 10k | 2k | **58k** |
| License | MIT | MIT + IEEE paper | Apache 2.0 |
| 跟 openchat 关系 | 直接竞品(都是 AI 编程 Agent) | 互补(若走本地模型) | 互补(接 OpenCode bash) |

---

## 三个共有的设计哲学

1. **协议化、SDK 化**: 都暴露 SDK / proxy / RPC, 而不是只做 CLI
   - oh-my-pi: 4 个 entry point
   - forge: 双协议 proxy
   - rtk: 14 个 AI tool 集成
2. **"对模型友好" 而非"对用户友好"**: 核心设计围绕"如何让模型少出错 / 少烧 token"
   - hashline / rescue parsing / output filtering
3. **从单一命令开始,长出生态**:
   - omp fork pi
   - forge 先 proxy 再 WorkflowRunner
   - rtk 先 12 个 git 命令再扩到 100+

## 对 openchat 的具体建议

| 优先级 | 动作 | 来源 |
|--------|------|------|
| P0 | 测 rtk 接 OpenCode 的 `tool.execute.before` hook | rtk |
| P1 | 引入 hashline-style 编辑 (provider-kit 的 edit 工具重写) | oh-my-pi |
| P2 | eval 框架抄 forge 的 26 场景 design (OG baseline + advanced) | forge |
| P2 | OpenCode 配置入口加 inherit AGENTS.md / .clinerules 之类 | oh-my-pi |
| P3 | 写 IEEE-style paper 描述 bridge 编排模式 | forge |

**最关键 takeaway**: 这三个都不是"对话玩具" — 都是把"模型能力 → 用户能用的产品"中间那道工程鸿沟当成主战场。openchat bridge 当前还在"能跑通"的阶段,往"工程化"转时,这三个的设计文档是必修课。
