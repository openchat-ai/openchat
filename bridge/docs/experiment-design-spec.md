# Experiment Design Spec

> **Status**: P0 — 移植自 mattpocock/skills `engineering/prototype`.
> **Applies to**: `src/experiments/NN-*.mjs` 与 `src/experiments/NN-*/index.mjs` (共 44 个 entry, 包含 51-diagnose 子目录型).
> **Why**: openchat 有 "实验当构件" 长期设想 (user memory: `experiments_vision.md`). 38+ 个实验是分散手工产物, 没有统一设计语言. 这个 spec 给 6 条 hard rules, 让 "实验怎么写" 和 "实验怎么描述" (`experiment-description-spec.md`) 平行可执行.
> **平行关系**:
> - `experiment-description-spec.md` = 给 LLM 看的 description 怎么写 (5 条, 关注 capability + trigger)
> - **本文件** = 给开发者看的实验本身怎么写 (6 条, 关注 throwaway + 1-cmd + no-persist)

---

## 核心论点 (抄自 prototype SKILL.md)

> **A prototype is throwaway code that answers a question. The question decides the shape.**

在 openchat 语境下:

- "Prototype" ≈ 一个 `experiments/` 下的 `.mjs` 文件, 答案驱动形状
- 任务是验证一个假设 (LLM 行为 / 库选型 / 协议实现 / 状态机), 不是写生产代码
- 答完即弃, 答案沉淀到 `REPORT.md` / ADR / commit message, 不留在 repo 里烂掉

**Goal**: 给开发者 6 条硬约束, 让 38+ 个实验从 day-1 就是"被明确标记的一次性代码", 不跟生产代码混淆.

---

## 6 条 Hard Rules

每条规则格式: **Rule 原文 (mattpocock 原句)** → **openchat 落地 (具体怎么映射)** → **正例 (openchat 现有做得好的)** → **反例 (现有做得不好的)**.

---

### Rule 1: Throwaway from day one, and clearly marked as such.

**Rule 原文**:
> Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious — but name it so a casual reader can see it's a prototype, not production.

**openchat 落地**:
- 路径前缀: `src/experiments/NN-name.mjs` 或 `src/experiments/NN-name/index.mjs`. `NN` 是序号, `name` 用 kebab-case.
- 文件头 5-10 行 `// === invariants ===` block, 写清楚"这个实验在测什么假设", 不写"这是一个生产级 X 模块".
- 命名禁忌: 不要用 `core/`, `runtime/`, `engine/`, `production/` 这种会被误读为生产代码的目录.
- 满足 1 条 = 加 manifest `_prototype: true` 字段; 满足 4+ 条 = 整目录加 `EXPERIMENT_PROTOTYPE.md` 顶头声明.

**正例**:
- `src/experiments/40.mjs` (guardrails-pipeline) 头部清晰写明 "MAX_ROUNDS=8, dryRun vs live" 是不变量, 不是产品配置.
- `src/experiments/51-diagnose/index.mjs` 头部 `// === invariants ===` 写明 8 条 invariants + "8 条已知失败模式库 hardcode 在 51-diagnose/index.mjs 内, 自包含" — 自包含是 throwaway 的关键属性.

**反例**:
- 早期实验 06-12.mjs 没有 invariants block, 假设藏在代码里, 读 30 行还不知道在测什么.
- 把"实验"放进 `bridge/src/memory/vector-store.js` 这种被生产代码 import 的位置 (`33.mjs` 包装它), 模糊了 throwaway 边界.

---

### Rule 2: One command to run.

**Rule 原文**:
> Whatever the project's existing task runner supports — `pnpm <name>`, `python <path>`, `bun <path>`, etc. The user must be able to start it without thinking.

**openchat 落地**:
- 默认运行命令: `node src/experiments/NN-name.mjs` 一行可跑.
- 入口契约: 顶部有 `export async function run({ inputs } = {})` (走 manifest 调度) 或 `if (import.meta.url === ...)` 守护的立即执行块 (独立可跑).
- 多文件实验 (51-diagnose 类型): `node src/experiments/51-diagnose/index.mjs` 一行可跑, 子模块放同目录.
- **必须**支持**无 env** 跑 (用 `process.env.X || '<default>'`), 不要"先 export OPENAI_API_KEY 才能 run".
- 例外: 标 `needsEnv: ['OPENAI_API_KEY']` 的 live 模式可以要求 env, dryRun 模式必须零 env 可跑.

**正例**:
- `src/experiments/40.mjs` (guardrails-pipeline) `META.needsEnv: []` + `live: false` 默认, `node src/experiments/40.mjs` 即可跑 dryRun.
- `src/experiments/01.mjs` 入口直接 `await import('./lib/config.mjs')`, 不需要任何 import dance.

**反例**:
- `src/experiments/18.mjs` (goal) 强依赖 provider-kit + LLM API, 没有 `dryRun` 入口, 改 prompt 后没法快速 unit 测.
- 实验没有 `META` export, dev-repl 找不到它, 只能手动 import — 违反 "one command".

---

### Rule 3: No persistence by default.

**Rule 原文**:
> State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE — wipe me" name.

**openchat 落地**:
- 默认 state in-memory: `const cache = new Map()`, `let session = { steps: [] }`, 进程退出即清.
- 严禁写 `~/.openchat/` (生产配置目录), `oc/recordings/` (录音目录), `bridge/state/` (bridge 持久化目录).
- 如果实验本身在测 persistence (e.g. 14-storage 实验, 38-process-recovery), 写 `oc/_prototype/NN-name/` 子目录, 文件名加 `_PROTOTYPE_wipe_me` 后缀.
- `META.persistent: false` 字段显式声明, 跑前必读.

**正例**:
- `src/experiments/40.mjs` 全程 `const` in-memory: `MOCK_TOOLS`, `SCENARIOS` 全是常量, 不写盘.
- `src/experiments/33.mjs` (memory) 包装的是 `src/memory/vector-store.js`, 但包装层是 in-memory Map 调度, 不直接持久化 (持久化在它包装的库里 — 库不是实验).

**反例**:
- 早期实验直接 `fs.writeFileSync('~/.openchat/test.json', ...)` 污染生产配置.
- 实验 14 (storage) 命名上像 storage, 实际是 "测试 persistent-store.js", 但实验代码本身又调 persistent-store — 双层混淆, 不像 prototype 倒像 integration test.

---

### Rule 4: Skip the polish.

**Rule 原文**:
> No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast and then delete it.

**openchat 落地**:
- 不写 lint 配置改动 (`eslint-disable` 注释 OK), 不写 unit test 文件.
- 异常处理: `try { ... } catch (e) { console.error(...) }` 即够, 不要 `Sentry.captureException`.
- 不抽公共方法: 重复 3 次就该抽 — 等等, **不要抽**. 重复 5 次了, 答完这个假设就删, 抽什么抽.
- 唯一的"polish" 允许: `META` 字段 + `run({ inputs })` 签名 (dev-repl 强契约, 不写跑不起来).
- 例外: 实验会被 `run-all.mjs` 跑回归, 所以**至少一个 `test()` 函数 + `report(NAME)`** 是必需的, 不算 polish 算 smoke test.

**正例**:
- `src/experiments/01.mjs` 末尾 `async function test()` 只测"config 模块能 import", 不测业务逻辑. 11 行, 跑通即过.
- `src/experiments/40.mjs` 4 场景 (simple-read / multi-step-edit / error-recovery / ...) 是 mock 序列, 验证组件契约, 不写 ground truth 比对.

**反例**:
- `src/experiments/27.mjs` (provider-failover) 写了 mock + live 两套, 又写了 5 个 test scenario, 总 400+ 行 — 像集成测试不像 prototype.
- 实验里出现 `class XxxFactory` / `Strategy` / `Builder` 模式 — 你在写生产代码, 停.

---

### Rule 5: Surface the state.

**Rule 原文**:
> After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.

**openchat 落地**:
- 实验是 terminal app (不是 UI), 所以**每次状态变化后 `console.log` 完整 state**.
- 格式约定: 每次输出用分隔符 `---` 开头, 字段一行一个, 例:
  ```
  --- state after step 3 ---
  steps: [...]
  cache.size: 4
  last_llm_response.tokens: 1280
  ```
- 终结时**必须**输出一个 `=== final ===` block, 含: 假设、结果、verdict (H0/H1/INCONCLUSIVE)、耗时、token 用量 (live 模式).
- `META.outputs` 字段写明返回结构, 跟 `=== final ===` 保持一致.

**正例**:
- `src/experiments/40.mjs` `SCENARIOS` 数组本身就是"state declaration" — 跑前看 30 行就知 4 场景是什么. Run 后 `delta` 字段直接给 baseline vs treatment 差值, 不需要再看代码.
- `src/experiments/51-diagnose/index.mjs` 输出 schema 头部写明 `fingerprints / loop / hypotheses / scaffold / notes` 5 字段, 跑完看一眼就知道哪些 fingerprint 命中、hypothesis 是什么.

**反例**:
- 实验只 `return { outputs: { ok: true } }` — 你 surface 了个寂寞.
- 实验 `console.log` 一堆 `step 1 done, step 2 done`, 但**不输出最终假设 vs 结果对照** — 跑完要再读代码才知道有没有验证.
- "5 件套 v2" 那 5 个 scaffold pieces 跑完不输出哪些 piece 被用了 — 违反 surface state, 也违反可观察性.

---

### Rule 6: Delete or absorb when done.

**Rule 原文**:
> When the prototype has answered its question, either delete it or fold the validated decision into the real code — don't leave it rotting in the repo.

**openchat 落地**:
- 答完假设的实验, **两个去处**:
  1. **Delete** — 假设证伪或已过期, 删 `.mjs` + 从 `manifest.json` 移除 entry.
  2. **Absorb** — 假设验证, 把结论 fold 进生产代码 (e.g. `src/memory/`), 实验本身删.
- 沉淀物: 写一个 `REPORT.md` 放在 `docs/learning/NN-name.md` (新建目录), 含:
  - 原假设 (一句话)
  - 验证方法 (一两个命令)
  - 结果 (H0 / H1 / INCONCLUSIVE)
  - 结论 + 行动 (删 / absorb 到 X 模块)
- 已有的 `REPORT.md` 例子: `src/experiments/49-mqtt-resume/REPORT.md` — 答完即写, 模式对了.
- **禁止**:
  - 跑通就丢在 repo, 不写 REPORT, 不删不 absorb (rotting).
  - 改 status 从 `closed-loop` 到 `paused` 当作 "答完了" — paused 是 "暂停保留", 不是 "答完".

**正例**:
- `src/experiments/49-mqtt-resume/REPORT.md` 存在 = 符合 rule 6 的"答完写答案".
- `src/experiments/51-diagnose/` 写成子目录 + `REPORT.md` (假设会写) + `test.mjs` 是 "结构上可被 absorb" 的样板.

**反例**:
- 38 个实验大部分没有 REPORT.md, 跑通 1 年后没人记得在测什么 — 严格违反 rule 6.
- 早期实验 01-05.mjs 是 "持久化配置 / feature flag" 包装, 已 absorb 进 `src/memory/`, 但实验文件还留着没删 — 该 absorb 时不 absorb, 该删时不删, 双失败.

---

## 反模式 (4 条)

违反 Rule 1-6 的常见模式, 写实验前自查:

| # | 反模式 | 违反哪条 | 怎么识别 |
|---|--------|----------|----------|
| 1 | **生产代码伪装成实验** | R1, R4 | 出现 `class Factory` / `Strategy` / `Builder` / `Repository` 关键词; 没 `META`; 没 `// === invariants ===`. |
| 2 | **"先跑通, 以后再 polish"** | R4 | 出现 `eslint-disable` > 3 处; 写 unit test 文件; 抽公共方法; 写 README. |
| 3 | **"实验需要 env 才能跑"** | R2 | `META.needsEnv: [X]` 但没 `dryRun` 入口; 一上来就 `throw new Error('OPENAI_API_KEY required')`. |
| 4 | **"跑通即完工, 答案在脑子里"** | R5, R6 | 没 `=== final ===` 输出; 没 `REPORT.md`; status 永远是 `closed-loop` 不动; 从 manifest 加进来 6 个月没人再改. |

---

## 自检清单 (15 条 checkbox)

写完一个实验, 对着勾一遍. **任一核心项 (标 * 的 4 条) 不通过 = 不准 commit**.

```
[ ] * R1 — 文件在 src/experiments/NN-*.mjs 或 NN-*/index.mjs, 不在 src/core/ 或 src/runtime/
[ ] * R1 — 头部 5-10 行 === invariants === block, 写明假设 + 约束
[ ] * R2 — node src/experiments/NN-name.mjs 一行可跑 (无 env 模式)
[ ] * R2 — 有 export const META = { id, name, status, needsEnv, inputs, outputs }
[ ]   R3 — 默认不写 ~/.openchat/ 或 oc/recordings/ 或 bridge/state/
[ ]   R3 — 测 persistence 的实验用 oc/_prototype/ 子目录, 文件名加 _PROTOTYPE_wipe_me
[ ]   R4 — 没 class Factory / Strategy / Builder / Repository
[ ]   R4 — 没单元测试文件 (除 run-all 必需的 test() 函数)
[ ]   R4 — eslint-disable 注释 ≤ 3 处
[ ]   R5 — 每次状态变化 console.log 完整 state, 用 `---` 分隔
[ ]   R5 — 终结时 `=== final ===` block 含 假设/结果/verdict/耗时
[ ]   R5 — META.outputs 跟 === final === 字段一致
[ ]   R6 — manifest status 不是 'paused' 当完工用
[ ]   R6 — 答完写了 REPORT.md (放 docs/learning/ 或实验目录)
[ ]   R6 — _todo 字段都清掉了 (description-spec, design-spec 等 TODO 标记)
```

---

## 跟 description-spec 联动

| dimension | description-spec | design-spec (本文件) |
|-----------|------------------|----------------------|
| 关注 | 给 LLM 看的 description 怎么写 | 给开发者看的实验本身怎么写 |
| 校验 | `scripts/check-experiment-descriptions.mjs` (R1-R5) | **TODO**: `scripts/check-experiment-design.mjs` (本文件 6 条) |
| 强制 | pre-commit / CI 必跑, 1 个 FAIL = 拒 commit | **Future**: 接入 verify-commit 钩子 (Step 3, 见下) |
| 数量 | 44 entry, 43 PASS, 1 FAIL (diagnose 第一句 157 chars 超 80) | 44 entry, 抽样 10 个 audit 见 `experiment-design-audit-2026-06-11.md` |

联动检查 (跑 description-spec validator, 看哪些 entry 既 description 合规又 design 合规):
- **P0 next**: description PASS + design 5/6 → 标 `golden` 候选
- **P1**: description PASS + design 3-4/6 → 加 `_todo: "design-spec"` 标记
- **P2**: description PASS + design 0-2/6 → 考虑 absorb 或删

---

## Future Work (不在本次范围)

- **Step 3**: 把 6 条接入 `bridge/scripts/verify-commit` 钩子, 至少 4 条 must (1-cmd, no-persist, surface-state, delete-or-absorb), skip-polish 是 nice-to-have.
- **Step 4**: 写 `scripts/check-experiment-design.mjs` 自动化扫描, 跟 description validator 平行, 输出 `manifest status + design score` 表.
- **Step 5**: 38 个实验的 absorb / delete 决策表 (哪个 absorb 到生产, 哪个删, 哪个留).

---

## 参考

- mattpocock/skills `engineering/prototype/SKILL.md` — 原文, 6 条 rules 1:1 移植.
- mattpocock/skills `engineering/prototype/LOGIC.md` — Logic branch 详解 (本次没引, 后续写 UI/UX 类实验时再引).
- openchat memory: `experiments_vision.md` — 实验当构件的长期设想.
- openchat `docs/experiment-description-spec.md` — 平行 spec, 关注 description 怎么写.
- openchat `scripts/check-experiment-descriptions.mjs` — description 校验器, 设计参考.
- openchat `src/experiments/49-mqtt-resume/REPORT.md` — rule 6 的正例.
- openchat `src/experiments/51-diagnose/index.mjs` — rule 1 + 5 的正例 (头部 invariants + 输出 schema).
