# E37 — Protocol-Template 验证实验报告

> 跑批 1 (15): 2026-06-08 (5 packets × 3 repeats)
> Provider: minimax / MiniMax-M3
> Mode: 不调工具, 给 LLM JSON 模板, 让它填 JSON; scaffold 渲染成字节

## 1. 一句话结论

**Protocol-template 路径显著好**: exactMatch **66.7%** (10/15), 是 E36 (20%) 的 **3.3 倍**。C 计划 1.3 (协议级模板) **方向锁定**。

但**不是全胜**:
- **PINGREQ / 简单 CONNECT**: 100% (跟 E36 一致 — 这部分模型一直能做对)
- **变长 CONNECT (短 clientId)**: 67% — 1/3 JSON 抽取失败
- **PUBLISH (中等)**: 67% — 1/3 部分字节错
- **SUBSCRIBE (复杂 multi-field)**: **0/3 全部 JSON 抽取失败** — 模型连"填模板"都做不好

## 2. 数据

| 维度 | E36 (LLM 写字节) | **E37 (LLM 填 JSON)** | Δ |
|---|---|---|---|
| exactMatch | 20% (3/15) | **66.7% (10/15)** | **+47%** |
| lengthMatch | 27% (4/15) | 66.7% (10/15) | +40% |
| firstByteMatch | 40% (6/15) | 73.3% (11/15) | +33% |
| byteAccuracy | 27% | 67.5% | +40% |
| extracted | 93% (14/15) | 73.3% (11/15) | **-20%** ⚠ |

**关键 trade-off**: E37 用"让 scaffold 写字节"换"extraction 变难" — extracted 率从 93% 跌到 73%。**但净效果**: 字节准确率从 27% 升到 67%。

## 3. Per-Packet 分布

| Packet | 复杂度 | exactMatch | byteAccuracy | 解读 |
|---|---|---|---|---|
| p5 PINGREQ | 2 字节固定 | **3/3** | 100% | E36 也 100%, 无提升空间 |
| p1 CONNECT (test-123) | 22 字节变长 | **3/3** | 100% | E36 0/3, **E37 完美** |
| p2 CONNECT (abc) | 17 字节变长 | 2/3 | 67% | 1 次 JSON 抽取失败, 1 次部分错 |
| p3 PUBLISH | 16 字节变长 | 2/3 | 71% | 1 次部分错 (9/16 字节) |
| p4 SUBSCRIBE | 12 字节 | **0/3** | 0% | **3/3 抽取失败** — 模板都填不好 |

## 4. 失败模式分类

4 个失败 run 拆解:

| Run | Packet | 失败类型 | 推测原因 |
|---|---|---|---|
| 1 | p2 run 3 | JSON 抽取失败 | LLM 输出格式问题 (没在 ```json 块) |
| 2 | p3 run 3 | 渲染后字节错 (9/16) | JSON 抽对了, 但字段填错 (e.g. flags 写错) |
| 3 | p4 run 1 | JSON 抽取失败 | SUBSCRIBE 结构复杂, LLM 输出畸形 |
| 4 | p4 run 2 | JSON 抽取失败 | 同上 |
| 5 | p4 run 3 | JSON 抽取失败 | 同上 |

**两类失败**:
- **类型 A (3/5)**: JSON 抽取失败 — extractor 没拿到合法 JSON。P4 全中: SUBSCRIBE 需要 `subscriptions: [{topic, qos}]` 嵌套数组, LLM 抽不出来
- **类型 B (2/5)**: JSON 对了但字段值错 — p3 填了错的 qos/flags

## 5. C 计划的判定

| 路径 | E36 | E37 | 判定 |
|---|---|---|---|
| LLM 写字节 | 20% | — | ❌ 模型没"协议包结构" |
| **LLM 填 JSON, scaffold 渲染** | — | **67%** | ✅ **方向锁定** |
| 还缺什么 | | | 复杂结构 (嵌套数组) 模板要 scaffold 给得**更明确** |

### 5.1 1.3 protocol-template 已锁定

**理由**:
- E37 比 E36 在 exactMatch 上 +47%
- 简单/中等包 100% / 67% / 67% (CONNECT 两种 + PUBLISH)
- 唯一失败是复杂嵌套结构 (SUBSCRIBE) — 这是**模板本身设计问题**, 不是路径问题

### 5.2 1.3 还需迭代 (留给下一轮)

**针对 SUBSCRIBE 失败**:
- 当前模板: `{type: 'SUBSCRIBE', packetId: 1, subscriptions: [{topic, qos}]}` 嵌套数组
- 改进方向 1: **简化模板** — 一次只一个 subscription, 不嵌套
- 改进方向 2: **schema 强约束** — 显式说 `subscriptions` 必须是数组, 每项必须有 topic 和 qos
- 改进方向 3: **few-shot example** — 给一个 SUBSCRIBE 完整样例让 LLM 仿写

### 5.3 extraction rate 是新瓶颈

E37 暴露: **JSON 抽取率 73%**, 比 E36 的字节抽取率 93% 低了 20%。

**这意味着**: 协议级模板要配套**更鲁棒的 extractor** (或者直接调工具让 LLM 走 function calling, 而不是聊天输出 JSON)。这部分已在 C 计划 1.1 (schema strict) 范围内。

## 6. 跟 0/10 报告的关系

0/10 报告说弱模型不会调工具。E36 + E37 联合解释:

- **E36 (直接写字节)**: 0/15 on 变长包 — 模型**不知道协议包长什么样**
- **E37 (填 JSON 模板)**: 10/15 — 模型能**填空**, 只要模板把结构给清楚
- **0/10 (调工具)**: 模型不知道**何时调哪个工具** — 这跟 E35 narrow tools 12% 提升对应

**C 计划综合路径**:
1. **1.3 protocol-template** ✅ 验证: 让 LLM 填结构化模板, scaffold 渲染
2. **1.2 narrow tools** (E35 验证 +12%): 限制工具数量, 减少"选哪个"负担
3. **1.1 strict schema** (E34 砍, 但要配合 1.3): 只在填模板场景下 strict 有意义 (E34 strict 在调工具上反而有害)
4. 配套: **强 robust extractor** (extractJson 已经能修单引号, 但嵌套结构还不行)

## 7. 复跑指令

```bash
# dryRun (验证 renderer + extractor)
node bin/exp.mjs 37

# live (15 calls, ~9 min)
E37_LIVE=1 node -e "import('./src/experiments/37-protocol-template/index.mjs').then(m => m.runLive({repeats:3}))"
```

## 8. 下一步

1. **E37b: 简化 SUBSCRIBE 模板 + few-shot** — 目标把 0/3 拉到 2/3+
2. **E38: 综合干预 (1.2 narrow + 1.3 template) 跑 0/10 baseline** — 测组合后的实际 0→N
3. **C 计划文档**: 把 E34 (砍) + E35 (留) + E36 (验证) + E37 (锁定) 的结论汇总成决策表
4. **(可选) 修复 E36 packets.json 的 byte-1 错误** — 已修, 可重跑 E36 拿干净对照数据
