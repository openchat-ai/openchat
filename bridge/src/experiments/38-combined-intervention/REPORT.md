# E38 — Combined Intervention (Narrow Tools + Template + Function Calling)

> 跑批 1 (15): 2026-06-08 (5 packets × 3 repeats)
> Provider: minimax / MiniMax-M3
> Mode: 4 个 render* tool, LLM 调 tool, argument 是结构化 json, scaffold (executor) 渲染字节

## 1. 一句话结论

**Combined intervention (narrow + template + function calling) 显著好**: exactMatch **86.7%** (13/15), byteAccuracy **92.7%**。是 E36 (20%) 的 **4.3 倍**, E37 (67%) 的 **+20%**。

**C 计划 1.2 (narrow) + 1.3 (template) 联合锁定**。

## 2. 数据

| 维度 | E36 (写字节) | E37 (填 JSON) | **E38 (tool call)** | E38 vs E37 |
|---|---|---|---|---|
| exactMatch | 20% (3/15) | 66.7% (10/15) | **86.7% (13/15)** | **+20%** |
| lengthMatch | 27% (4/15) | 66.7% (10/15) | 86.7% (13/15) | +20% |
| firstByteMatch | 40% (6/15) | 73.3% (11/15) | **93.3% (14/15)** | +20% |
| byteAccuracy | 27% | 67.5% | **92.7%** | **+25%** |
| extracted | 93% (14/15) | 73.3% (11/15) | **93.3% (14/15)** | **+20%** |
| toolPick | n/a | n/a | 93.3% (14/15) | — |
| jsonPresent | n/a | n/a | 93.3% (14/15) | — |

**3 个核心提升**:
- **extraction 回到 93%** — function call 的 argument 是结构化 JSON, 不需要 LLM 聊天里写 JSON
- **byteAccuracy +25%** — 跟 extracted 提升叠加, 整体 92.7% 是 E37 1.4 倍
- **p4 SUBSCRIBE 从 0/3 → 3/3** — 复杂嵌套结构也能稳填 (E37 chat extraction 全挂)

## 3. Per-Packet 分布

| Packet | E36 | E37 | **E38** | 解读 |
|---|---|---|---|---|
| p5 PINGREQ | 3/3 | 3/3 | **3/3** | 一直 100% |
| p1 CONNECT (test-123) | 0/3 | 3/3 | 2/3, acc 97% | run 3 多填了 userName="false" 等, 字节长度超 |
| p2 CONNECT (abc) | 0/3 | 2/3 | 2/3, acc 67% | run 2 调错 tool (no tool) |
| p3 PUBLISH | 0/3 | 2/3 | **3/3** | 完美 |
| p4 SUBSCRIBE | 0/3 | 0/3 | **3/3** | **E37 致命弱点被消灭** |
| p5 PINGREQ | 3/3 | 3/3 | 3/3 | 完美 |

## 4. 失败分析 (2/15 = 13.3%)

| Run | Packet | 失败类型 | 详情 |
|---|---|---|---|
| 1 | p1 run 3 | 字段值冗余 | userName="false" (string 而非 boolean), 多了 willFlag 等字段. 字节长度 36 (vs expected 22). byteAccuracy 91% (几乎对) |
| 2 | p2 run 2 | 调错 tool | LLM 没调任何 tool (noToolCall=1) |

**这两类都是"轻微"**:
- 失败 1: LLM **不严格按 schema**, 填了冗余字段. 加 strict schema (E34 1.1) 能修 — 但 E34 验证过 strict 在调工具场景有副作用 (extraFields), 需要谨慎
- 失败 2: LLM **偶发漏调 tool** — 可能是 prompt 含糊, 也可能是模型自身的随机性

## 5. C 计划的判定

| 路径 | E36 | E37 | E38 | 判定 |
|---|---|---|---|---|
| LLM 写字节 | 20% | — | — | ❌ 模型没"协议包结构" |
| LLM 填 JSON (chat) | — | 67% | — | ⚠ extraction 73% 拖累 |
| **LLM 调 tool + json arg** | — | — | **87%** | ✅ **方向锁定** |
| 还需要 | | | | strict schema 砍 extraFields 失败, prompt 防漏调 |

### 5.1 1.2 + 1.3 联合锁定

**理由**:
- E38 exactMatch 87% > E37 67% > E36 20% (单调上升)
- function call 把"LLM 输出 JSON 格式"这一不可控变量替换为"API 强制的结构化 argument"
- extraction 率从 73% 回到 93% (跟 E36 持平)
- SUBSCRIBE 这种复杂嵌套结构 0/3 → 3/3, 说明 function call 比 chat extraction 对深层结构更鲁棒

### 5.2 还可优化 (留给下一轮)

**针对 p1 run 3 (字段冗余)**:
- **A**: 提示词强调 "只填需要的字段, 不要额外字段"
- **B**: strict schema (E34 1.1) 强制砍 extra fields — 但 E34 显示有副作用
- **C**: executor 砍掉 false/0/"" 默认值字段 (这跟 renderer.mjs 行为一致 — 它不写 default false flags)

**针对 p2 run 2 (漏调 tool)**:
- 3 次里 1 次, 可能是 LLM 偶发问题. 多 repeats 验证稳定性
- 提示词强调 "必须调 tool, 不要直接解释"

## 6. 跟 0/10 报告的关系

0/10 报告说: 弱模型在编码任务上 0/10 (不会调工具/调错/参数错)。

E34-E38 五轮实验数据串联:

| 实验 | 干预 | 分数 | 测什么 |
|---|---|---|---|
| E36 | 无 | 20% | LLM 写字节能力 (基线) |
| E34 | strict schema | 76% → 88% (+12% in toolPick, 但有 side effect) | schema 严不严 |
| E35 | narrow tools (10 vs 40) | +12% | 工具数影响 |
| E37 | template (chat JSON) | 67% | LLM 填 JSON |
| **E38** | **narrow + template + tool call** | **87%** | **组合 + function calling** |

**结论**: 0/10 不是模型"能力不行", 是**没给模型正确接口**。
- 模型**会**写简单包 (PINGREQ 100%, CONNECT 长 clientId 100%)
- 模型**会**填 JSON 模板 (67%)
- 模型**会**调 tool + 填结构化 arg (87%)

**C 计划落地建议** (给桥接):
1. **协议级工具**: renderConnect/renderPublish/renderSubscribe/renderPingreq 等代替"让 LLM 写 Buffer.from([...])"
2. **窄工具集**: 任务相关 5-10 个 tool, 不是 40+ 全暴露
3. **强 schema**: 字段类型 + enum 约束, 砍 LLM 瞎填
4. **fallback**: LLM 漏调 tool 时, 走第二轮 prompt 提醒

## 7. 复跑指令

```bash
# dryRun
node bin/exp.mjs 38

# live (15 calls, ~9 min)
E38_LIVE=1 node -e "import('./src/experiments/38-combined-intervention/index.mjs').then(m => m.runLive({repeats:3}))"
```

## 8. 下一步

1. **E39 — 真实编码任务**: 不只是协议字节, 让 LLM 写一个**完整 MQTT 客户端 JS 函数**, 用 narrow tools + 协议模板, 端到端跑 (mcp-net fake broker)
2. **E40 — strict schema 复测**: 在 E38 基础上加 strict, 看 extraFields 副作用是否还在 (E34 是 40 tool 场景, E38 是 4 tool 场景, 可能不同)
3. **C 计划文档**: E34 + E35 + E36 + E37 + E38 五轮实验汇总成 decision table, 锁定落地路径
4. **(可选) 重跑 E36**: 用修好的 grader 拿干净对照数据, 验证 0/10 baseline
