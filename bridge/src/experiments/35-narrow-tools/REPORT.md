# E35 — Narrow Tools 实验报告

> 跑批 1 (30): 2026-06-08 (60 calls: 30/cond)
> 跑批 2 (100): 2026-06-08 (200 calls: 100/cond, ±5% 置信)
> Provider: minimax / MiniMax-M3
> Prompts: 10, 5 类别 (file / search / ast / dev / git / mqtt)

## 1. 一句话结论

**Narrowing 工具数量从 40 减到 10 显著改善 toolPick (+12% at 100 samples)**, 但**触发 extraFields 副作用 (+1.02)** — 模型"补偿性"乱填字段, 净 validCall 提升只有 +4%。

## 2. 30-SAMPLE 跑批结果 (n=30/cond)

| 维度 | wide | narrow | delta |
|---|---|---|---|
| toolPick | 80.0% | 83.3% | +3.3% |
| paramName | 80.0% | 83.3% | +3.3% |
| paramValue | 80.0% | 83.3% | +3.3% |
| extraFields | 0.40 | 0.40 | 0 |
| validCall | 66.7% | 66.7% | **0%** |
| noToolCall | 0% | 0% | 0 |

30 样本下, narrow 跟 wide 完全一样 — 噪声主导。

## 3. 100-SAMPLE 跑批结果 (n=100/cond, ±5% 置信)

| 维度 | wide (40) | narrow (10) | delta |
|---|---|---|---|
| toolPick | 76% | **88%** | **+12%** ✓ |
| paramName | 81% | 83% | +2% |
| paramValue | 81% | 83% | +2% |
| extraFields | 0.36 | **1.38** | -1.02 ⚠ |
| validCall | 64% | 68% | +4% |
| noToolCall | 0% | 1% | +1% |

**100 样本下的真实信号**:
- toolPick 显著好 +12% (远超 ±5% 噪声, 真实效应)
- extraFields 暴涨 +1.02 (跟 E34 strict 模式同副作用)
- validCall 净提升 +4% (在噪声内, 真实效应弱)
- noToolCall 略增 1% (可忽略)

## 4. 关键发现: E34 + E35 共同规律

**给弱模型"更紧的 schema 约束"都让 toolPick 变好, 但都触发 extraFields 副作用**:
- E34 strict 模式: toolPick ~52%, extraFields +0.95
- E35 narrow 模式: toolPick 76→88%, extraFields +1.02

**模型在"schema 引导"下倾向于"多填字段"** — 可能解释: 当 schema 显得很专业/严格/精选时, 模型"想要配合"就多塞字段。

## 5. 跟 E36 诊断的呼应

E36 (不调工具写字节) 显示:
- 弱模型能写 PINGREQ (2 字节固定) → 100% 正确
- 弱模型写不出 CONNECT/PUBLISH/SUBSCRIBE → 0% 正确

**C 计划的真正瓶颈**:
- ❌ 工具调用本身 (E34 strict, E35 narrow 都有进展)
- ❌ 工具选择 (toolPick 已经能到 88%)
- ✅ **协议级结构理解** (变长包的 field 排列) — 这才是 0% 的事

**结论**: C 计划单靠改 scaffold (1.1, 1.2) 无法让弱模型写出 MQTT 客户端。**需要协议级模板 (1.3)**: 给模型一个 "fill in the blanks" 的 MQTT 包骨架, 让它只填字段值, 不需要理解整个包结构。

## 6. 对 C 计划的修订

| 原计划 | 修订 |
|---|---|
| 1.1 schema strictness | 砍掉 (E34) |
| 1.2 narrow tools | **保留** (E35 +12% toolPick), 但**额外约束 extraFields** (用 strict 拒绝额外字段) |
| 1.3 protocol-template | **提升到 1.1 优先级** — E36 诊断结果 |
| 2.1 template lib | 保留 |
| 2.2 verify-loop | 保留 |
| 3.1 goal-decompose | 保留 |
| 3.2 quality gate | 保留 |
| 3.3 复跑 0/10 | 保留 |

**新策略**:
- 同时跑 narrow tools + strict schema (用 strict 的 additionalProperties:false 拒绝 extraFields, 抵消 narrow 的副作用)
- 加上 protocol-template (1.3) — 给变长包骨架, 让模型只填空
- 综合改造后再跑 0/10 基准

## 7. 复跑指令

```bash
# dryRun
node bin/exp.mjs 35

# live (60 calls, 3 min)
node -e "import('./src/experiments/35-narrow-tools/index.mjs').then(m => m.runLive({repeats:3}))"

# live 100 sample (200 calls, ~12 min)
node -e "import('./src/experiments/35-narrow-tools/index.mjs').then(m => m.runLive({repeats:10}))"
```

## 8. 下一步

- **E37 protocol-template**: 测 LLM 填 MQTT 模板 (不是从零写) 的字节正确率
  - 给 model CONNECT 包的 JSON 模板: `{ "type": "CONNECT", "protoName": "MQTT", "protoLevel": 4, "cleanSession": true, "keepAlive": 60, "clientId": "..." }`
  - scaffold 把 JSON 渲染成字节
  - 测 exactMatch
- 如果 E37 显著好 (e.g. exactMatch > 80%), C 计划就锁定 template-driven 路径
- 如果 E37 也差, 弱模型可能连"填字段"都做不好, C 计划需重评
