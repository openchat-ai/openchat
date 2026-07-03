# 对标 Cursor 路线图 — 确定性代码库 Agent

> 起草 2026-07-02。目标：让 openchat agent 达到 Cursor 级"代码库感知 + 自主编辑"体验，
> 但走**确定性路线**（符号索引 + hash 锚点编辑），而非 Cursor 的概率路线（embedding + apply model）。

---

## 0. 一句话结论

Cursor 的智能 = 语义检索 + Apply model + 自主编辑循环。openchat 已有**两者的确定性替代**
（DNA 符号索引、hashEdit 锚点编辑），真正缺的不是零件，是**把零件接成 LLM 自主驱动的闭环**。
本路线 3 个实验（E43/44/45）+ 一套 Lab TUI 补齐。

---

## 1. 现状盘点（实证，2026-07-02）

| 能力 | 位置 | 状态 |
|---|---|---|
| DNA 符号索引（6 项目/509 模块/1985 export，名字+行号+hashline+依赖图+invariants+边界隔离） | `42.mjs` `answerFromDNA/getDNAContext` + `.dna/project-dna.json` | ✅ 有，但只是独立函数 |
| hashEdit 锚点编辑（按 hashline hash 精确定位改一行，hash 不匹配即拒改） | `lib/coding-lib.mjs:1892` `hashEdit(filePath, hash, newContent)`，在 `EDIT_TOOLS` 白名单 | ✅ 有，已是 tool |
| tool-loop（多轮工具循环 + neural-bridge 难度自适应） | `lib/llm-lib.mjs`（22 tool-loop）+ `lib/coding-lib.mjs` `TOOLS` | ✅ 有 |
| **dna_query 作为 LLM 工具** | — | 🔴 **不存在**，`llm-lib` 零引用 DNA |
| DNA 增量更新 | `42.mjs` `maxAgeMs=300000` 全量重扫 | 🟡 静态快照，非增量 |
| hashline 索引粒度 | 仅 export 声明行 | 🟡 无函数体 / 无调用点，"谁调用 X"退回 grep |
| 交互式界面 | `bin/openchat.mjs` readline REPL；`dev-repl.mjs` = stub | 🟡 基础，无实验/DNA 可视化 |

### Cursor ↔ openchat 组件对照

| Cursor（概率式） | openchat（确定性） | 差异价值 |
|---|---|---|
| embedding 语义检索 `@codebase` | DNA 符号索引 | 零 embedding 成本、精确定位、适合弱模型、可查架构违规 |
| Apply model（LLM 猜 diff 落点） | hashEdit（hash 锚点） | 零漂移，hash 对不上就拒改 |
| Agent 自主检索-编辑-验证循环 | **待建（E43）** | — |

---

## 2. E43 — dna-agent-loop（最高杠杆）

> 把 DNA 检索 + hashEdit 接成 tool-loop 可自主调用的闭环。补 gap#1。

### 目标
LLM 在 tool-loop 里能自主完成："查 DNA 定位符号 → 拿 `file:line:hash` → hashEdit 精确改 → 跑测/lint 验证 → hash 失配则重查自修"。等价于 Cursor 的 agent 编辑体验，但每步确定性可验。

### 数据流
```
用户目标
  → getDNAContext() 注入 system prompt（模块/export/invariants 摘要）
  → LLM 调 dna_query("find function X") → {file, line, hash}
  → LLM 调 read_file(file) 读上下文（可选）
  → LLM 调 hashEdit(file, hash, newContent) 精确改
  → 若 hash 失配 → 工具返回结构化错误 + 提示"DNA 已过期，重新 dna_query"
  → LLM 调 lint_run/test_run 验证
  → trainOnOutcome 反馈 neural-bridge
```

### 接口签名（新增/改动）
- `lib/coding-lib.mjs`：新增工具 `dna_query`（包一层 `42.mjs` 的 `answerFromDNA`）
  ```
  { name: 'dna_query', description: '符号级代码库检索：find function X / hash XXXX / ls path / summary / hot / cat prefix / isolate',
    parameters: { query: {type:'string', required:true} } }
  → executeTool('dna_query', {query}) → answerFromDNA(query).answer
  ```
- `lib/coding-lib.mjs`：`hashEdit` 已在 `TOOLS`，确认其 schema 暴露给 tool-loop（若缺则补 tool 定义）。
- `lib/llm-lib.mjs`：processText 入口调 `getDNAContext()` 注入 system prompt；`dna_query` 加入默认工具集（读类，可进 `READ_ONLY_TOOLS`）。
- `hashEdit` 失配错误 shape：`{ ok:false, code:'HASH_STALE', hint:'call dna_query to refresh anchor' }`（供 LLM 自修）。

### 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| `43.mjs` | 实验：DNA→hashEdit→验证闭环 + test() 断言 | 200 |
| `43.spec.md` | 契约 | — |
| `lib/coding-lib.mjs`（改） | +dna_query 工具 + hashEdit 失配 shape | +≤40 |
| `lib/llm-lib.mjs`（改） | getDNAContext 注入 + dna_query 入工具集 | +≤30 |

### 调试检查点
| C | grep | 预期 |
|---|---|---|
| C1 | `[C1] dna_query` | LLM 调 dna_query，返回 file:line:hash |
| C2 | `[C2] hashEdit ok` | 锚点命中，文件被改 |
| C3 | `[C3] HASH_STALE` | 失配路径触发，LLM 重查 |
| C4 | `[C4] verify` | lint/test 通过 |

### 验收标准
- `test()` 断言：给定"改某 export 一行"目标，闭环 15-run ≥ 80% 成功（对齐 C 计划口径）。
- HASH_STALE 分支被至少 1 个用例覆盖（改坏 hash → LLM 重查恢复）。
- `dna_query` 出现在 `openchat --help` 工具列表。

### 依赖 / 风险
- 依赖 42（DNA）+ 09/24（coding/edit）+ 22（tool-loop）。
- 风险：DNA 5min 快照 vs 编辑后 hash 立即失效 → E43 用 HASH_STALE 自修兜底，E44 根治。

---

## 3. E44 — incremental-dna（补 gap#2）

> DNA 从"全量重扫快照"升级为"文件变即增量更新"，让 hashline 锚点实时可信。

### 目标
编辑一个文件后，只重算该文件的 export/hash，秒级刷新 `.dna/project-dna.json`，消除 E43 的 HASH_STALE 窗口。

### 数据流
```
fs.watch(scanDirs) → debounce(300ms) → 单文件 scanProject 子集
  → 合并进 .dna/project-dna.json（替换该 file 的 modules 条目）
  → 广播 dnaUpdated 事件（tool-loop 下一轮拿到新 hash）
```

### 接口签名
- `44.mjs`：`startIncrementalDNA({watch=true})` / `updateFile(path)` / `stopIncrementalDNA()`
- `42.mjs`（改）：`writeDNAFile` 抽出 `mergeModule(dna, fileResult)` 供增量复用。

### 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| `44.mjs` | fs.watch + debounce + 单文件增量合并 | 200 |
| `44.spec.md` | 契约 | — |
| `42.mjs`（改） | 抽 `mergeModule` | +≤25 |

### 调试检查点
| C | grep | 预期 |
|---|---|---|
| C1 | `[C1] watch start` | watcher 起 |
| C2 | `[C2] file changed` | 捕获变更 |
| C3 | `[C3] dna merged` | 单文件合并，scannedAt 更新 |

### 验收标准
- 改一行后 ≤500ms `.dna` 反映新 hash；未变文件条目不动（diff 只含该文件）。
- 增量结果与全量重扫对该文件**逐字节一致**（回归断言）。

### 依赖 / 风险
- 依赖 42。风险：watcher 跨平台（Windows/macOS/Linux fs.watch 语义差异）→ 用 debounce + 兜底定时全扫。**后台任务铁律**：watcher 独立启动，不占主线。

---

## 4. E45 — hashline-callgraph（补 gap#3）

> hashline 从"只索引 export 声明行"扩到"调用点 / 引用"，支持 `find callers of X`，无需退回 grep。

### 目标
DNA 记录每个 export 的被引用位置（调用点 file:line:hash），让 agent 做影响面分析（改 X 前先看谁调用 X）。这是 Cursor "find references / 改动影响预览"的确定性版。

### 数据流
```
buildDependencyGraph 已有 import 边
  → 新增 extractCallSites(content)：正则/轻量 AST 抽 identifier 调用
  → 与 exports 名字表 join → callers: { exportName: [{file,line,hash}] }
  → 写入 .dna（callgraph 段）
  → dna_query 新增 "callers X" / "refs X"
```

### 接口签名
- `45.mjs`：`extractCallSites(content, relPath)` / `buildCallGraph(dna)` → `{ callers: Record<name, Site[]> }`
- `42.mjs`（改）：`answerFromDNA` 新增 `callers X` / `refs X` 分支。

### 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| `45.mjs` | 调用点抽取 + callgraph 构建 | 200 |
| `45.spec.md` | 契约 | — |
| `42.mjs`（改） | `answerFromDNA` +callers/refs 分支 | +≤30 |

### 调试检查点
| C | grep | 预期 |
|---|---|---|
| C1 | `[C1] callsites` | 抽出调用点 > 0 |
| C2 | `[C2] callgraph` | join 出 callers 表 |
| C3 | `[C3] callers query` | dna_query("callers X") 返回站点 |

### 验收标准
- 对已知 export（如 `getDNAContext`）`callers` 查询命中真实调用点，误报率可接受（正则精度，非 full AST）。
- 不显著拖慢 DNA 生成（callgraph 为可选段，超时降级）。

### 依赖 / 风险
- 依赖 42（+ 44 增量）。风险：正则抽调用点精度有限（同名遮蔽、动态调用漏抓）→ 标注为"启发式"，不做强一致承诺；需要精确时才上 AST（09/24 已有 ast_* 工具可复用）。

---

## 5. Lab TUI（配套交付）

> 现有交互仅 `bin/openchat.mjs` readline REPL + stub dev-repl。补一套实验室 TUI，
> 让"研究更智能模式"可视化操作：浏览实验 / 看依赖树 / 查 DNA / 跑实验。

### 功能
1. **实验浏览**：读 `manifest.json`，按层（0/1/2）+ 智能分级（L0–L4）+ status 分组，键盘 ↑↓ 导航、Enter 查看详情、依赖/被依赖。
2. **DNA 面板**：交互式 `dna_query`（find / hash / ls / summary / hot / cat / isolate / callers）。
3. **运行**：跑单实验 `test()` / 跑 `run-all` / 看结果。
4. **仪表盘**：`getDNAContext()` 摘要（模块/export/invariants/边界违规）。

### 技术
- 纯 Node + `chalk`（已装），`readline` + `emitKeypressEvents` raw-mode 键盘导航；非 TTY 降级为数字菜单。**不引入 blessed/ink**（避免新重依赖）。
- 文件（R1 ≤200 行/文件，R6 一文件一责任）：
  | 文件 | 职责 |
  |---|---|
  | `tui/tui.mjs` | 入口 + 主循环 + 键盘路由 |
  | `tui/data.mjs` | 数据源（manifest / DNA / 树） |
  | `tui/render.mjs` | 渲染（box / 色彩 / 树 / 列表） |
  | `tui/actions.mjs` | 动作（跑实验 / DNA 查询） |
- `package.json` 加 `"lab": "node src/experiments/tui/tui.mjs"`。

### 验收
- `npm run lab` 起 TUI，方向键可导航 41 实验，Enter 看详情，可跑 `test()` 与 DNA 查询，`q` 退出且恢复终端。

---

## 6. 优先级与里程碑

| 顺序 | 实验 | 补的 gap | 交付 |
|---|---|---|---|
| 1 | **Lab TUI** | 可视化研究入口（先给 UI） | `npm run lab` |
| 2 | **E43** | agent 自主检索-编辑-验证闭环 | 对标 Cursor 核心 |
| 3 | **E44** | DNA 增量，消除 HASH_STALE | 锚点实时可信 |
| 4 | **E45** | callgraph，影响面分析 | find references |

> 遵循 Spec-First：每个 `4X.mjs` 与 `4X.spec.md` 同提交；改 `42.mjs` 同步更 `42.spec.md`。
> 遵循小步高频：一实验一提交，diff ≤500 行。

---

## 7. 用户交互对齐 Cursor（不只是内核）

> 内核（E43 检索+编辑闭环）只是"能做"。Cursor 真正的体验在**交互层**：
> agent 每一步透明可见、编辑落盘前可审查、危险操作可拦截。这一层同样走确定性路线。

### Cursor 交互特征 ↔ openchat 对齐

| Cursor 交互 | openchat 对齐 | 状态 |
|---|---|---|
| Agent 工具调用实时可视化（在读/在改什么） | TUI agent 视图：工具流卡片（🔍dna_query / 📄read_file / ✏️hash_edit） | 🟡 本轮做 |
| **内联 Diff + Accept/Reject**（编辑落盘前逐块审查） | **edit-gate (E46)**：写工具 dry-run 出 unified diff → 用户 a/r 决策 → accept 才落盘 | 🟡 本轮做 |
| Plan mode（先给计划，用户批准再执行） | agent 视图 plan 阶段：列步骤 → y 批准 → 执行 | 🟡 本轮做 |
| @-mention 上下文（@file/@symbol/@code） | 输入 `@符号` → 自动 dna_query 注入上下文 | ⚪ 后续 |
| 权限门控（shell/删除需确认） | edit-gate 对写工具默认 gate；只读工具直通 | 🟡 本轮做 |
| 可中断长任务 | agent loop 每 round 可 Esc 中止 | 🟡 本轮做 |

### E46 — edit-gate（编辑审查门）

**目标**：写工具（hash_edit/edit_file/write_file）落盘前 **dry-run** 出确定性 unified diff，
经用户 accept 才真落盘。这是 Cursor Apply/Accept 的确定性版——diff 由真实文件计算，零幻觉。

**数据流**
```
tool call (写)
  → previewEdit(tool,args)  读文件+定位, 计算 before/after, 不落盘   [C1]
  → unifiedDiff(before,after)  行级 +/- 彩色 diff                    [C2]
  → 用户 [a]ccept / [r]eject / [s]kip
  → accept → applyEdit() = executeTool(tool,args) 真落盘              [C3]
  → reject → 丢弃, agent 记录未应用                                  [C4]
只读工具 (dna_query/read_file/grep) 不过 gate, 直通。
```

**接口签名**（`lib/edit-gate.mjs`）
- `previewEdit(tool, args): Promise<{path, before, after, ok, error?}>` — dry-run，hash 失配返回 HASH_STALE
- `unifiedDiff(before, after, path): string` — 彩色行级 diff
- `applyEdit(tool, args): Promise<result>` — 经 coding-lib executeTool 落盘
- `isWriteTool(name): boolean`

**文件清单**
| 文件 | 职责 | 行数上限 |
|---|---|---|
| lib/edit-gate.mjs | dry-run 预览 + unified diff + 落盘 | 200 |
| lib/edit-gate.spec.md | 契约 | — |
| tui/agent.mjs | TUI agent 视图：plan + 工具流 + diff 卡片 + a/r 决策 | 200 |
| tui/agent.spec.md | 契约 | — |

**验收**
- `previewEdit('hash_edit', 命中)` 返回 before/after，不改文件；失配返回 HASH_STALE
- `unifiedDiff` 正确标注 `-旧行 / +新行`
- accept → 文件变；reject → 文件不变（test 断言）
- TUI `npm run lab` → agent 模式：输入目标 → 看 plan → 逐工具流 → 编辑出 diff 卡片 → a/r 生效
