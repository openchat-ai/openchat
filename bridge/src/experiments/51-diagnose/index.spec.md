# spec: 51-diagnose
> 把 mattpocock/skills engineering/diagnose 的 Phase 1 (建 feedback loop) + Phase 3 (3-5 ranked falsifiable hypothesis) 移植成 openchat 实验.
> 核心问题: 给一段失败 LLM transcript, 能不能自动匹配到 openchat 已知失败模式 (8 条 fingerprint), 推荐 1-3 种 feedback loop + 5 件套 v2 scaffold + 3-5 个 ranked falsifiable hypothesis.

## 假设

- H0 (零假设): 自动 fingerprint 匹配 0 增益 — 用户看完 LLM transcript 自己也能看出根因, scaffold 推荐是噪音.
- H1 (备择假设): 8 条 hardcode fingerprint 覆盖 openchat L1.5 v1/v2/v3 的真实失败模式, scaffold 推荐命中率 ≥ 70%, 缩短"看见自己失败"的时间.

证伪条件: 跑完 Case 1-4 后, 如果 fingerprint 命中 0 条或 hypothesis 数量 0, 失败. 如果 hypothesis 不含 "If X then Y" 格式, 失败.

## 数据流

```
输入 transcript (string)
  ↓
[heuristic 阶段]
  fingerprint matcher → 命中 0..N 条 (regex 多 pattern)
    ↓
  loop recommender → 按 priority 排 primary + secondary + tertiary
    ↓
  scaffold recommender → 5 件套 v2 件 1-5 选
[LLM 阶段]
  hypothesis generator → prompt 注入 fingerprint + transcript
    ↓
  parse JSON → 1..5 ranked falsifiable hypothesis
    ↓
  LLM 失败 → _localHypotheses 兜底 (永不崩)
  ↓
合并输出: { fingerprints, loop, hypotheses, scaffold, notes }
```

## 接口签名

```js
// 输入
{
  transcript: string,         // 必填
  failureDescription: string, // 选填
  context: object | null,     // 选填, { provider, model, taskType }
}

// 输出
{
  fingerprints: [{ id, label, evidence: [string], confidence: number }],
  loop: { primary: { key, name, mattpocock, fromFailures? }, secondary?, tertiary?, rationale },
  hypotheses: [{ rank: 1..5, claim, prediction, falsify }],
  scaffold: { pieces: [{ id: 1..5, name, whys: [{ from, why }] }], tier: 1..3, totalPieces },
  notes: string,
  meta: { hypothesisSource, fingerprintCount, tier }
}
```

## 失败模式库 (8 条 hardcode)

| id | label | tier | feedback loop | 5 件套 |
|---|---|---|---|---|
| round0-zero-tool-call | round 0 零 tool call | 1 | rewrite-user-prompt, force-tool-choice | 件 1+2 |
| hallucinated-system-reminder | 幻觉 system-reminder 服从 | 2 | strip-system-reminder, assert-role-boundary | 件 4+1 |
| narrative-instruction-low-compliance | narrative 指令字面服从率低 | 3 | switch-strong-model | 件 5 |
| systemmsg-strong-constraint-no-effect | M3 systemMsg 强约束 0 效果 | 2 | user-role-promotion, differential-test | 件 4 |
| tier2-retry-no-change | Tier 2 retry 不变 | 2 | clear-empty-content, switch-strong-model | 件 4+5 |
| max-rounds-hit | max rounds 撞 30 | 2 | task-split, easier-task | 件 3+1 |
| json-stringify-failover | JSON.stringify 误 failover | 1 | try-catch-wrap, reproducer-minimal | 件 4 |
| magic-tag-not-rescued | magic 标签没救 | 1 | inject-cheat-sheet, register-exit-pattern | 件 1 |

## 已知限制

- LLM-driven 部分依赖 provider-kit, 若 config 缺失/无 api key → 走 _localHypotheses 兜底
- fingerprint 库是 L1.5 v1/v2/v3 + C-PLAN §5 + OPENCHAT-BEHAVIOR-SPEC §3 的归纳, 不保证覆盖未知新模式
- 5 件套 v2 映射到 cplan_scaffold_decision.md, 移植时不改 5 件套本体
- 不做 Phase 4-6 (那是修, 不是诊断)

## 边界条件

- `inputs.transcript` 缺失或非 string → throw `51-diagnose.run: inputs.transcript (string) is required`
- `inputs.transcript` 为空字符串 → fingerprint 0 命中, 走 _localHypotheses 兜底, 出 1 条 "transcript 信息不足" hypothesis
- LLM 不可用 (无 provider / 无 api key / connect fail) → _localHypotheses 兜底, outputs.meta.hypothesisSource = `local-fallback`
- LLM 返回非 JSON (parse fail) → _localHypotheses 兜底, hypothesisSource = `local-fallback-parse-fail`
- fingerprint 命中 0..N 任意, 永不抛
- hypothesis 数量 1..5, 永不为 0
- 5 件套 v2 件 1-5 任意组合, pieces 数组可能为空 (0 fingerprint 时), 不抛
- tier 1-3, 0 fingerprint 时 tier = 1

## 文件清单

- `src/experiments/51-diagnose/index.mjs` — 主实验 (heuristic + LLM hybrid, run/test/META)
- `src/experiments/51-diagnose/test.mjs` — 4 case dry-run 入口
- `src/experiments/51-diagnose/KNOWN_FAILURES.md` — 8 条 fingerprint markdown 文档
- `src/experiments/51-diagnose/index.spec.md` — 本 spec 文件
- `src/experiments/manifest.json` — 注册 diagnose entry (id=diagnose, file=51-diagnose/index.mjs, intelligenceLevel=L1.5)

## 测试

4 case dry-run, 全部 expect pass:
- Case 1: v3 transcript → 期望命中 round0-zero-tool-call
- Case 2: v2 transcript → 期望命中 hallucinated-system-reminder
- Case 3: 自定义撞 30 rounds → 期望 3-5 hypothesis 含 If/then
- Case 4: 0 fingerprint 兜底 → 期望 ≥ 1 local hypothesis
