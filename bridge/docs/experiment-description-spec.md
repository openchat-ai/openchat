# Experiment Description Spec

> **Status**: P0 — 移植自 mattpocock/skills `productivity/write-a-skill`.
> **Applies to**: `src/experiments/manifest.json` `experiments[].description` 字段.
> **Why**: LLM 在 dev-repl 里看到的 toolList description + manifest capability 重复且不规范. 这个 spec 统一两者, 让 description 成为 agent 唯一看到的触发器.

---

## 核心论点 (抄自 write-a-skill)

> **The description is the only thing your agent sees** when deciding which skill to load. It's surfaced in the system prompt alongside all other installed skills. Your agent reads these descriptions and picks the relevant skill based on the user's request.

**Goal**: 给 agent 刚好够的信息知道 —
1. 这个 experiment 提供什么能力 (capability)
2. 什么时候触发它 (具体关键词, 上下文, 文件类型)

---

## 硬约束 (5 条)

| # | 规则 | 说明 |
|---|------|------|
| 1 | **Max 1024 chars** | 超出 agent 看不到. |
| 2 | **第三人称** | 用 "It / The skill / Reads / Writes". 不要 "I / we / 我 / 我们". |
| 3 | **第一句: 它做什么 (capability)** | 动词开头. 一句话说清能力, 不写背景故事. |
| 4 | **第二句: `Use when [具体触发词]`** | 3-10 个关键词, 逗号分隔. 关键词是 LLM 真会用的词 (中文 + 英文混 OK). |
| 5 | **纯文本, 无装饰** | 不用 emoji, 不用 markdown, 不用代码块, 一句话或两句. |

---

## 反例 (3 条) — 错的 description

1. **太空** — `"Helps with documents."`
   - 错在哪: 没 capability, 没 trigger, agent 没法判断要不要用.

2. **第一人称 + 废话** — `"I can help you configure your feature flags with env overrides, super useful for A/B testing and feature rollouts."`
   - 错在哪: "I", 太长没 trigger, "super useful" 是噪音.

3. **背景故事 + 技术细节泄漏** — `"持久化配置读取 ~/.openchat/config.json. ID=1"`
   - 错在哪: 没 "Use when", "ID=1" 是内部实现不该给 LLM 看, 像日志不像 trigger.

---

## 正例 (3 条) — 对的 description

> 来源: 移植到 openchat manifest 后的目标格式. 三个例子分别对应 capability 单一 / capability 复合 / 带触发词丰富的情况.

1. **简单 capability**:
   ```
   Reads and writes files with hash-anchored edits. Use when user asks to edit, modify, or create source files.
   ```

2. **复合 capability (一个实验干两件事)**:
   ```
   Decomposes a goal into ordered steps and executes them via the tool-loop agent. Use when user asks to "拆目标", "分步执行", "execute a goal", or wants multi-step autonomous work.
   ```

3. **领域专用 (带具体文件/工具词)**:
   ```
   Polls chat messages, deduplicates by message ID, encodes audio via LMDN codec, and forwards through provider-kit. Use when chat-poller, mqtt bridge, incoming message, or webhook delivery.
   ```

---

## 自动校验规则

`scripts/check-experiment-descriptions.mjs` 跑这 5 条规则, 任一失败 → entry FAIL.

| 规则 | 检查 | 失败信息 |
|------|------|----------|
| R1 | `description.length <= 1024` | `description too long: <N> chars (max 1024)` |
| R2 | 第三人称 (不出现 ` I ` / ` my ` / `我们` / `我能` / `帮你`) | `first-person pronoun detected: "<word>"` |
| R3 | 第一句 ≤ 80 chars 且以动词或名词开头 | `first sentence too long or starts with non-action word` |
| R4 | 必须含 `Use when` (或大小写变体) | `missing "Use when" trigger clause` |
| R5 | 不含 emoji (regex `/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u`) | `emoji detected: "<char>"` |

可选 (warning, 不算 FAIL):
- W1: 触发词数量 < 3 — 提示 "trigger list short, consider adding more keywords".
- W2: `description` 末尾残留 `ID=<number>` 这种内部字段.

---

## 落地策略 (38 个 entry)

不强求 1 次写完. **P0**: 写 5-8 个 dev-repl 高频用 (goal, tool-loop, step-workflow, memory, coding, tool-rescue, guardian, multi-session). 其余加 `_todo: "description-spec"` 字段标记, 等触发再补.

**严禁**:
- 把 `name` 字段当 description 用 (name 是给人类看的, description 是给 agent 看的).
- 抄 `name` 然后加 "Use when" 前缀 — 第一句必须是 capability, 不是名字复读.

---

## 参考

- mattpocock/skills `productivity/write-a-skill/SKILL.md` — 原文.
- openchat memory: `experiments_vision.md` — 实验当构件的长期设想.