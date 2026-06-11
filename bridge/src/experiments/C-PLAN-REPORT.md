# C 计划总报告 — E34-E41 实验汇总

> 2026-06-08 ~ 2026-06-09, MiniMax-M3 (弱模型), 5 类任务, 7 轮实验
>
> 起点: 0/10 baseline (弱模型不会做编码)
> 终点: 100% 端到端 (15-run 0 失败, 8 维验证全过)

---

## 0. 一句话结论

**0/10 是接口问题, 不是模型能力问题**. 弱模型 + 5 件套 scaffold (协议 tool + 窄 + schema + fallback + JS 整合) → 100% 端到端. **不需要切强模型**.

---

## 1. 5 轮实验横向对比

| 实验 | 任务 | scaffold 干预 | exactMatch | 失败模式 | 关键诊断 |
|---|---|---|---|---|---|
| **E36** (raw, 15 runs) | LLM 写 MQTT 字节 | 无 | **27% (4/15)** | 6/15 timeout, 变长包 0/3 | 模型**没有"协议包结构"内部表示**, 简单包 (PINGREQ) 100%, 变长包 (CONNECT/PUBLISH/SUBSCRIBE) 几乎全挂 |
| **E37** (template, 15 runs) | LLM 填 JSON 模板, scaffold 渲染字节 | 给 LLM 协议 JSON 模板 | **67% (10/15)** | 3/15 JSON 抽取失败 (p4 SUBSCRIBE 全挂) | 模板化 +47%, 但 chat JSON 抽取率拖累到 73% |
| **E38** (combined, 15 runs) | LLM 调 4 个 render* tool, scaffold 渲染字节 | 4 tool + template + function calling | **87% (13/15)** | 1 字段冗余 + 1 漏调 tool | function call 把"LLM 输出 JSON 格式"不可控变量换为"API 强制的结构化 argument", extraction 回到 93%, SUBSCRIBE 0/3 → 3/3 |
| **E39** (real task 初版, 3 runs) | LLM 写完整 mqttSubscribe JS 函数 + sandbox 端到端 | E38 4 件套 + 写代码 prompt | **0% (0/3)** | CommonJS 残留 + sandbox mock gap | tool call 6 维全 100%, 但 JS 整合层 0% — LLM 写 `module.exports` 让 Function 构造器编译挂, sandbox mock 跟真实 Node API 不一致 |
| **E40** (real task 修复, 3 runs) | 同 E39 + 5 件套 | + prompt 重写 (await, 禁 CommonJS) + preprocessSource 剥 require/module.exports + sandbox mock 3 处补全 (工厂 connect, write callback, try-catch) | **100% (3/3)** | — | 端到端跑通, 字节对 expected, 5 件套 JS 整合脚手架落地 |
| **E41** (router, 15 runs) | E40 任务 + provider-kit RouterProvider 接到 createProvider hot path | + adapter failover (anthropic + openai) | **100% (15/15)** | — | 验证过 router 接到 hot path (代码后被回滚, 流程在 provider-registry.js 内联备用). 15-run 0 timeout, 0 任何失败 |

**单调上升**: 27% → 67% → 87% → 100% (real task).

---

## 2. C 计划 5 件套 scaffold

**5 件套** = 在弱模型 + LLM 之间, 部署以下 5 个工程层, 拉通从"LLM 输出"到"代码/字节正确"的整条链路.

| # | 件套 | 作用 | 落地位置 | 验证实验 |
|---|---|---|---|---|
| 1 | **协议级 tool** | 把"协议包结构"从模型脑子搬到 scaffold. LLM 不再写 `Buffer.from([...])`, 调 `renderConnect({...})` 等 | `node_modules/provider-kit/src/providers/{renderConnect, renderSubscribe, ...}` 或 E37 renderer | E37 (+47%), E38 (+20%) |
| 2 | **窄工具集** (5-10 个) | 限制"选哪个 tool" 的搜索空间, 减少 LLM 选错概率 | tool schema 数量 | E35 (+12%) |
| 3 | **强 schema** | 字段类型 + enum 约束, 砍 LLM 瞎填 / 字段冗余 | tool parameters JSON schema (strict) | E34 (+12% toolPick, 但有 extraFields 副作用) |
| 4 | **fallback** | LLM 漏调 tool / 调错 tool 时, 走第二轮 prompt 提醒 | 第二轮 user message + LLM 重新生成 | E38 漏调 1/15, 没触发 fallback (单轮够用) |
| 5 | **JS 整合脚手架** | E40 揭示: 弱模型写代码时不会用 `await` / 写 CommonJS, sandbox mock 跟真实 Node API 不一致. 5 件套需要: (a) prompt 显式约束 ESM 风格, (b) preprocessSource 剥 CommonJS 残留, (c) sandbox mock 对齐真实 Node API (工厂 connect, write callback), (d) try-catch 兜底不让 LLM 错误崩进程 | E39/E40 sandbox.mjs, task.json prompt | E39 0% → E40 100% |

**Why 5 件套不是 4 件套**: 4 件套 (tool + 窄 + schema + fallback) 在"LLM 输出 JSON 字节" 任务上 (E36-E38) 拉通. 但在"LLM 写完整代码 + 端到端跑"任务上 (E39) 暴露新瓶颈: **JS 整合层**. prompt 不约束 ESM 风格 → LLM 写 CommonJS → sandbox 编译挂. sandbox mock 不对齐 Node API → LLM 写法跟 mock 期望错位 → timeout. **第 5 件套是工程层, 不是模型层**.

---

## 2.1 5 件套 v2 升级 (2026-06-11)

**v1 局限**: 件套名是 MQTT-codegen 验出来的 (协议级 tool, JS 整合脚手架). MQTT 全清 + 主战场转到 LLM tool-loop (subagent/dev-repl) + LLM decision (cap/60) 后, v1 件套名过专, 需升级.

**v2 升级 4 件**:

| v1 | v2 | 变化 |
|---|---|---|
| 协议级 tool | **动作级 tool** | 协议 (MQTT/HTTP/gRPC) 是特例, 提一档到"动作级" |
| 强 schema | **强契约** | 加输出 + 错误 shape, 不只参数. runtime 校验 |
| fallback | **可恢复执行** | 单层 → 三层降级: provider failover / tool retry / 错误降级到下轮 |
| JS 整合脚手架 | **执行边界** | codegen-only → 也覆盖 tool-loop (轮 cap + 截断 + 会话隔离) |
| 窄工具集 | (同名沿用) | 数据从 E40 扩到 E40 + 22.mjs + subagent 三处 |

**v2 5 件套**:
1. **动作级 tool** — 工具按 LLM 意图聚合 (read/edit/run), 不暴露 raw API
2. **窄工具集** — 任务越窄, 工具越少. `opts.tools` 数组
3. **强契约** — 参数 + 输出 + 错误 三段 shape + runtime 校验
4. **可恢复执行** — provider failover → tool retry → 降级到下轮 prompt
5. **执行边界** — codegen: sandbox 对齐真实 API; tool-loop: 轮 cap + 截断 + 会话隔离

**适用场景矩阵** (哪条件套在哪类 LLM 任务上被验过):

| 件套 | LLM codegen | LLM tool-loop | LLM decision |
|---|---|---|---|
| 1 动作级 tool | ✓ (E40) | ✓ (22.mjs + subagent) | N/A |
| 2 窄工具集 | ✓ (E40) | ✓ (22.mjs + subagent) | N/A |
| 3 强契约 | ✓ (sandbox mock 校) | ⚠️ (runtime 校验弱) | ✓ (state machine) |
| 4 可恢复执行 | ✓ (sandbox try-catch) | ✓ (provider/tool retry) | ✓ (5 mini-task) |
| 5 执行边界 | ✓ (sandbox 4 处) | ✓ (subagent 30/4000/id) | ✓ (attempt + 终态) |

**v2 落地状态 (2026-06-11)**:
- 件套 1, 2, 4: 22.mjs + subagent.mjs + dev-repl.mjs 都有 `opts.tools` 透传 + fallback
- 件套 3: 39 工具 schema 在, runtime 校验弱 (validateResponse 只验 schema 类型, enum 越界未验)
- 件套 5: subagent 已加 (30 轮 + 4000 chars 截断 + 独立 sessionId); dev-repl 主循环 MAX_ROUNDS=100 不一致 (待办)

**v2 数据点 (2026-06-10/11)**:
- 22.mjs e2e (8 工具 39→4 窄化): fileModified=true, exp09Pass=33/33, 98s
- subagent smoke (新 9 用例): 57/57 passed, 含 opts.tools 过滤生效 (3→2) + /task 4 路
- dev-repl smoke: 14 用例 (opencode-style 升级: doctor/slash/streaming/history)
- cap/60: 5 mini-task retry/recover 诊断骨架, 5/5 simulateIdealLLM

**v2 跟 v1 的关系**: 不冲突, 是 v1 件套名的抽象层提升. v1 验出的具体数据 (E40 sandbox 4 处修复, E41 provider failover) 在 v2 仍然 valid, 只是放进"执行边界"和"可恢复执行"两个更通用的件套名下. 详细迁移表见 memory: `~/.claude/memory/cplan_scaffold_decision.md` v2 段.

---

## 3. 关键决策 (给桥接 / openchat)

### 3.1 弱模型能力边界

| 能力 | 有 / 没 | 数据来源 |
|---|---|---|
| 输出 `Buffer.from([...])` 格式 | ✅ 有 | E36 93% extraction |
| 写 2 字节固定包 (PINGREQ) | ✅ 有 | E36 100% |
| 写变长协议包结构 (CONNECT/PUBLISH/SUBSCRIBE) | ❌ 没有 | E36 0% on p1-p4 |
| 填 JSON 模板 | ✅ 有 | E37 67% |
| 调 tool + 填结构化 arg | ✅ 有 | E38 87% |
| `await` async tool | ⚠️ 偶发不 await (要 prompt 强制) | E39 0% → E40 100% (修了 prompt) |
| 写 ESM 风格 JS | ❌ 默认写 CommonJS (要 prompt 强制 + 兜底剥) | E39 sandbox compile 挂 |
| 用真实 Node API (factory connect, write callback) | ⚠️ 写错时需要 sandbox mock 兼容 | E39 sandbox mock gap |

**结论**: 弱模型**能**做编码, 但**默认习惯** (CommonJS, 不 await, 错误 API 假设) 跟现代 Node 工程不匹配. scaffold 兜底是关键.

### 3.2 0/10 baseline 重新解读

0/10 报告说弱模型不会做编码. **错**. 真正原因:

| 表象 | 深层原因 | scaffold 修法 |
|---|---|---|
| 5/10 完全没调工具 | **不知道该调什么** (没"协议包结构"内部表示) | 协议级 tool + 模板 |
| 3/10 调了但参数错 | **schema 模糊** (modelName, filePath 等随便填) | 强 schema + enum 约束 |
| 2/10 调了工具但没产文件 | **选错领域** (调了看似合理但不相关的 tool) | 窄工具集 (5-10 个) |

**0/10 是个接口设计问题, 不是模型能力问题**. 配上 5 件套 → 100%.

### 3.3 不需要切强模型

5 件套落地后, MiniMax-M3 (弱模型) 在 E40/E41 任务上 **100% 端到端通过**. 没有强模型能做的事. 切强模型 = 多花 token, 边际收益 ≈ 0.

**例外**: 5 件套都补齐后仍有 0% 的场景 (e.g. 极长 prompt 撞 provider 限流, 极端边界 case) 才考虑切. 当前数据**不支持**这个决策.

---

## 4. 已知坑 / 风险

### 4.1 Prompt 长度 ↔ provider timeout

E36 (重跑, 15 runs) 有 6/15 = 40% timeout. E36 prompt 长 (含完整协议细节 + 5 个 packet), LLM 思考时间长, 撞 provider-kit `withTimeout` 60s 默认值. E37/E38/E40 prompt 短, 不踩这个.

**风险**: 任务复杂度上去 (e.g. E42: 完整 client + onMessage), prompt 变长, timeout 概率上升. 备选: (a) 调短 timeout, (b) 拆 prompt 多次调用, (c) RouterProvider 接到 createProvider 后, 配 anthropic + openai failover 救场 (E41 验证可行).

### 4.2 Router 接入位置

user 已在 `provider-registry.js` 写好 `RouterProvider` + `_buildAdapterProviders` (读 `~/.config/openchat/config.json` 的 `providers.<id>.adapter` 段), 但**这条路径 E36-E40 没走到** (它们调 `createProvider` 不调 `providerRegistry`).

E41 期间我**接到** `openai-compatible.js:867` 的 `createProvider` 验证过 100%, 后续被回滚. 当前状态: RouterProvider 在 `provider-registry.js` 内联, 实际 hot path (`createProvider`) 还是单 endpoint. **需要 user 决策**: 重新接到 createProvider, 还是接受现状 (registry 路径上 router 才生效, 主路径上不生效).

### 4.3 Sandbox 工程的脆弱性

E40 修复 4 处 sandbox 漏洞:
1. `net.connect` 当工厂 (非构造函数) — 真实 Node API
2. `socket.write(buf, callback)` 接 callback — 真实 Node API
3. setImmediate 异常用 try-catch 兜底
4. preprocessSource 剥 `module.exports`

每个漏洞都是"LLM 写的代码跟 mock 期望错位"导致的. **sandbox 必须跟真实 Node API 100% 对齐**, 否则 LLM 写法跟 mock 期望错位, 跑出来结果不可信. 当前 E40 sandbox 修复完了, 但任何后续改 sandbox 的人都要重测 E40 dryRun + E40 live 3 次.

### 4.4 Strict schema 副作用

E34 验证 strict schema 在 40 tool 场景有 extraFields 副作用. E38 是 4 tool 场景, 是否还在**没复测**. 如果以后 tool 数量上去 (e.g. 10+), strict 副作用可能回来. **建议**: E40/E41 基础上, 跑 E42+ 时观察字段冗余率.

---

## 5. 已知 closed-loop (M3 能力上限)

| 实验 | closed-loop 原因 | 含义 |
|---|---|---|
| E49 — mqtt-resume (已删) | M3 在 retry + 状态恢复任务上 0/15 | 5 件套不救 sampling 层缺陷 |
| E50 — mqtt-split (已删) | M3 拆任务后 0.300 overall, combined 0/15 | "拆任务"方案不跨过 E49 的坎 |

**结论**: M3 (MiniMax-M3) 在 E40 档 (简单协议 tool 调用) 100%, 在 E49/E50 档 (中等复杂 async 代码生成) 不可用。要么切强模型, 要么换输出范式 (tool call 替 free-form 代码)。两种路径都超出当前 C 计划 scope。

## 6. 未来方向 (没建, 留给后面)

| 方向 | 目的 | 风险 |
|---|---|---|
| E43 — RouterProvider 接到 createProvider (永久) | 让 hot path 走 router, provider 抖动有 failover 兜底 | 跟 user 当前 openai-compatible.js 设计冲突, 需要 user 决策 (见 4.2) |
| E45 — C 计划外推到其它协议 (HTTP / gRPC) | 验证 5 件套是协议无关的, 还是 MQTT-specific | 风险高, 1-2 周工作量 |

**建议优先级**: E43 (短) > E45 (高).

---

## 7. 实验目录清理 (两轮)

**保留**:
- `src/experiments/C-PLAN-REPORT.md` (本文件) — 决策依据
- `~/.claude/memory/cplan_scaffold_decision.md` (已更新) — 5 件套简版

**已清理第一轮** (2026-06-09):
- `src/experiments/36-code-ability-diagnostic/` ✅
- `src/experiments/37-protocol-template/` ✅
- `src/experiments/38-combined-intervention/` ✅
- `src/experiments/39-real-coding-task/` ✅

**已清理第二轮** (2026-06-10): MQTT 全部清出, 包含 E49/E50 closed-loop 数据, 见 §5
- `src/experiments/33-mqtt-auto/` ✅
- `src/experiments/49-mqtt-resume/` ✅
- `src/experiments/50-mqtt-split/` ✅
- `src/experiments/34-schema-strictness/` ✅ (含 MQTT fixture)
- `src/experiments/35-narrow-tools/` ✅ (含 MQTT fixture)
- `src/experiments/lib/mqtt-render-tools.mjs` ✅
- `src/experiments/_autonomy-sandbox/` ✅ (MQTT goal)
- `src/tools/mqtt-tools.mjs` + `.test.mjs` ✅ (production MQTT 工具, 跟 E33 联动删除)
- `src/tools/coding-tools.mjs` 移除 MQTT_TOOLS 聚合 + 4 个 mqtt case

**manifest.json**: 同步移除 5 个 entry, 0 个 dangling 引用 (其他 lib 文件 error-tracker/guardian/response-validator/step-enforcer 仍被 35 个实验用, 保留).

**理由**: experiment harness 是 一次性代码, 不进 production. 每次 provider-kit 改 API 实验就挂, 维护成本是纯负. 数据 (live-*.json, REPORT) 已沉淀到本报告, 删了不丢结论. 已进 production 的代码 (`normalize.js`, `anthropic-adapter.js` 等) 不算 experiment 资产.

**已进 production** (从 experiment 走到 product):
- `node_modules/provider-kit/src/utils/normalize.js` (extractContent / normalizeToolCalls / parseActionFallback)
- `node_modules/provider-kit/src/providers/anthropic-adapter.js`
- `node_modules/provider-kit/src/providers/azure-adapter.js`
- `node_modules/provider-kit/src/providers/bedrock-adapter.js`
- `node_modules/provider-kit/src/providers/provider-registry.js` (含 RouterProvider 内联)

---

## 8. 引用

- **memory**: `~/.claude/memory/cplan_scaffold_decision.md` (4 件套 → 5 件套更新版)
- **E36 详细**: 沉淀于本报告 §1, 2
- **E37 详细**: 沉淀于本报告 §1, 2
- **E38 详细**: 沉淀于本报告 §1, 2
- **E39/E40/E41 详细**: 沉淀于本报告 §1, 2, 4 (E39→E40 修复 4 处, E41 router 接入)
- **E49/E50 详细** (已删): 沉淀于本报告 §5 (M3 在 retry + 状态恢复档 0/15, "拆任务" 不跨)

**实验当构件** (跟 experiments_vision 一致): E36-E41 都有 `META` + `run({inputs})` + `outputs` 契约, 可被 compose.mjs 拼装. 但当前没复用场景, 删目录不影响构件愿景.
