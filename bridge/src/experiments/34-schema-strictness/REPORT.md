# E34 — Schema Strictness 实验报告

> 跑批 1: 2026-06-08 (60 calls: baseline vs strict)
> 跑批 2: 2026-06-08 (90 calls: baseline / padded / strict — 隔离 length 变量)
> 跑批 3: 2026-06-08 (300 calls: 100/condition, ±5% 置信区间)
> Provider: minimax / MiniMax-M3
> Prompts: 10, Repeats: 1/3/10

## 1. 一句话结论

**Schema strictness 模式（additionalProperties:false + STRICT markers + DO NOT + Example）对弱模型**:
- 不改善 toolPick / paramName / paramValue / validCall（差异在噪声 ±5% 内）
- **显著增加 extraFields（+0.95, 0.61 → 1.56）**: 模型在 strict 模式下生成大量额外字段
- **C 计划 1.1 砍掉** — strict 模式不是中性, 明确有副作用

## 2. 100-SAMPLE 终局数据 (300 calls, 100/condition)

| 维度 | baseline | padded | strict |
|---|---|---|---|
| toolPick | 52% | 53% | 52% |
| paramName | 57% | 61% | 54% |
| paramValue | 56% | 61% | 53% |
| extraFields | 0.61 | 0.55 | **1.56** ⚠ |
| validCall | 40% | 43% | 41% |
| noToolCall | 0% | 0% | 1% |

| delta | padded-base | strict-base | strict-padded |
|---|---|---|---|
| toolPick | +1% | 0% | -1% |
| paramName | +4% | -3% | **-7%** ⚠ |
| paramValue | +5% | -3% | **-8%** ⚠ |
| extraFields | -0.06 | **+0.95** ⚠ | **+1.01** ⚠ |
| validCall | +3% | +1% | -2% |
| noToolCall | 0% | +1% | +1% |

## 3. 关键发现

### 3.1 strict 模式导致 extraFields 暴涨

strict (1.56) vs baseline (0.61) / padded (0.55) — strict 模式让模型平均多生成 ~1 个额外字段。

**可能解释**: strict 模式的 description 含 "STRICT SCHEMA" / "Required" 标记, 模型把 strict 理解成"需要填所有可能的字段"而过度填充。

**实际后果**: 即便 toolPick 没错, strict 模式的 validCall 也没显著高于 baseline (41% vs 40%)。strict 没用, 反而多了垃圾字段。

### 3.2 strict 标记 (DO NOT / STRICT) 单独有副作用

strict vs padded (长度相同, 仅有 strict 标记) — paramName/paramValue 下降 7-8%。

**可能解释**: "DO NOT use `file_path`" 这种负面指令在弱模型上效果差。模型可能"想要规避 file_path"导致**参数值也错**。

### 3.3 length 本身无害

padded vs baseline (仅 description 变长) — 几乎完全相同 (1% 差异内)。

**结论**: 单纯加 example 文本不害, 但**也不显著帮助**。

## 4. 三次跑批的对照

| 跑批 | n/cond | 结论 |
|---|---|---|
| 跑批 1 (60) | 30 | strict 全面差 -6.7% (被噪声误导) |
| 跑批 2 (90) | 30 | strict 全面好 +10% (反向噪声) |
| 跑批 3 (300) | 100 | 三组在 ±5% 内, strict 唯一信号是 extraFields +0.95 |

**教训**: 30 次样本的二项分布标准差约 9%, 不能区分 ±10% 差异。**100 次样本是最低门槛**。

## 5. 对 C 计划的影响

| 原计划项 | 终审判定 |
|---|---|
| 1.1 schema strictness 升级 | **砍掉** — 副作用明确 (extraFields 暴涨) |
| 1.2 narrow tools | 提到 1.1 之前, 优先做 |
| 1.3 protocol-template | 保留 — E33 已证明 templates 方向可行 |
| 2.1 template lib | 保留 |
| 2.2 verify-loop | 保留 |
| 3.1 goal-decompose | 保留 |
| 3.2 quality gate | 保留 |
| 3.3 复跑 0/10 | 保留 |

## 6. 复跑指令

```bash
# dryRun (无需 LLM, 验证 schema 结构 + scoring)
node bin/exp.mjs 34

# live (300 次 LLM 调用, ~15 分钟)
node -e "import('./src/experiments/34-schema-strictness/index.mjs').then(m => m.runLive({repeats:10}))"
```

## 7. 下一步

- **E35 narrow tools**: 测 "工具数量" 对弱模型选择准确率的影响
  - WIDE: 暴露 40 个 tool
  - NARROW: 暴露 10 个 tool (与 prompts 相关)
  - 假设: NARROW 在 toolPick 上显著好 (因为选择空间小)
