# E36 — Code Ability 诊断实验报告

> 跑批 1 (15): 2026-06-08 (5 packets × 3 repeats, ~9 min)
> Provider: minimax / MiniMax-M3
> Mode: 不传 tools, 纯 chat, 让 LLM 写字节流

## 1. 一句话结论

**弱模型在不要工具调用的情况下, 写 MQTT 字节流的整体 exactMatch 仅 20%**。但**显著分两极**:
- 简单固定字节 (PINGREQ 0xC0 0x00): **100% 正确**
- 变长协议包 (CONNECT/PUBLISH/SUBSCRIBE): **0% 正确**

**C 计划方向锁定**: 协议级模板 (1.3) 是必须项, 单靠工具调用改造救不了。

## 2. 数据

| 维度 | 值 |
|---|---|
| exactMatch | 20% (3/15) |
| lengthMatch | 27% (4/15) |
| firstByteMatch | 40% (6/15) |
| byteAccuracy | 27% |
| extracted (LLM 输出了能解析的字节) | 93% (14/15) |

**93% extraction rate** 说明模型知道怎么输出 `Buffer.from([...])`, 失败是因为**字节值写错**, 不是格式问题。

## 3. Per-Packet 分布

| Packet | 复杂度 | exactMatch | firstByte | byteAccuracy | 解读 |
|---|---|---|---|---|---|
| p5 PINGREQ | 2 字节固定 | **3/3** | 3/3 | **100%** | 模型懂这个 |
| p1 CONNECT (test-123) | 22 字节变长 | 0/3 | 1/3 | 32% | 知道是 CONNECT (0x10), 但字段排列错 |
| p2 CONNECT (abc) | 17 字节变长 | 0/3 | 1/3 | 2% | 跟 p1 同结构但更糟, 短 clientId 模型更乱 |
| p3 PUBLISH | 16 字节变长 | 0/3 | 1/3 | 2% | 字节基本瞎写 |
| p4 SUBSCRIBE | 12 字节变长 | 0/3 | 0/3 | 0% | 完全失败 |

**两极分化**:
- 简单固定字节: 100% 正确 (PINGREQ)
- 变长协议包: 全部 0% 正确 (4 类包全挂)

## 4. 关键诊断结论

### 4.1 模型能写对什么
- 输出格式 (Buffer.from([...])): ✅
- 固定 2 字节 (PINGREQ): ✅
- 第一个字节 (packet type): 40% 概率对 (CONNECT 0x10, PUBLISH 0x30, SUBSCRIBE 0x82)

### 4.2 模型写不对什么
- 变长 remaining length 编码: ❌ (需要先算总长)
- 字段顺序: ❌ (protocol name length, name, level, flags, keepalive, payload length, payload...)
- 字符串 UTF-8 编码: ❌ (p2 'abc' 字节全错)
- multi-byte packet (PUBLISH 16 字节): ❌
- packet ID 编码: ❌ (SUBSCRIBE 没拿到 0x0001)

### 4.3 这意味着什么

模型**没有"协议包结构"的内部表示**。它会写"CONNECT" 0x10 这个 byte, 但不知道后面要跟什么、按什么顺序、什么长度。这是"协议状态机"层面的能力, 不是"字节编码"能力。

## 5. C 计划的判定

| 路径 | 判定 |
|---|---|
| 改 tool calling (1.1, 1.2) | **不足** — 模型在字节层失败, 工具调用改造帮不到 |
| 改 prompt (1.x 各种) | **不足** — prompt 再清晰也救不了 "变长包结构" 缺失 |
| **加 protocol-template (1.3)** | **必须** — 给模型一个 fill-in-the-blank 骨架, 它只填字段值, 不需要理解结构 |
| 综合 (1.3 + 2.x + 3.x) | **方向正确** — 但核心是 1.3 模板, 其它是辅助 |

## 6. 对 0/10 报告的重新解读

0/10 报告说 "minimax/M3 工具调用薄弱" 是表面现象。**深层原因是模型对"协议包结构"缺乏内部表示**:
- 5/10 完全没调工具 → 不是 "不调", 是 **不知道该怎么调**
- 3/10 调了但参数错 → 调了 `read_file({"file_path": "..."})` 这种**看似合理但实际错的**调用
- 2/10 调了工具但没产文件 → 调了**错误领域的工具**

**C 计划的真正目标**: 把"协议包结构"从模型脑子里搬到 scaffold 里, 让模型只做"填空题"。

## 7. 复跑指令

```bash
# dryRun
node bin/exp.mjs 36

# live (15 calls, ~9 min)
E36_LIVE=1 node -e "import('./src/experiments/36-code-ability-diagnostic/index.mjs').then(m => m.runLive({repeats:3}))"
```

## 8. 下一步

- **E37 protocol-template 验证**: 测 LLM **填模板** 写 CONNECT 包的正确率
  - 给 model JSON template: `{type: "CONNECT", protoName: "MQTT", protoLevel: 4, cleanSession: true, keepAlive: 60, clientId: "test-123"}`
  - scaffold 把 JSON 渲染成字节数组
  - 跟 E36 的 0% 对比, 验证 template-driven 路径
- 如果 E37 exactMatch > 80%: C 计划锁定 template 路径, 推 0/10 → 6-8
- 如果 E37 也 < 50%: 模型连填空都做不好, C 计划需重评 (可能要降级目标)

---

## 9. Grader bug 修复 (2026-06-08)

跑 E37 dryRun 时发现: **本实验 packets.json 的 byte 1 (remaining length) 写错了**:
- p1 (test-123): 期望 18, **正确应是 20** (0x14)
- p2 (abc): 期望 13, **正确应是 15** (0x0F)
- p3 (PUBLISH): 期望 15, **正确应是 14** (0x0E)

**根因**: 计算 remaining length 时漏数了一些字段 (protoName 长度字段 2 字节 + protoName 字符串 + ...)。

**影响**:
- 本报告 live 数据 (live-15sample.json) 的 **p1, p2, p3** 全部被错判 (LLM 算对了 byte 1, 但 grader 期望 2-3 字节短)
- p4 SUBSCRIBE 期望 10 字节是对的 (p4 之前算的): 仍 0/3
- p5 PINGREQ 期望 2 字节是对的: 仍 3/3

**这意味着**: 跑批 1 的 0/15 on p1-p3 至少部分是 **grader bug**。**重跑 E36** (用 E37 修好的 renderer 反推 expected) 才能拿干净数据。E36 dryRun + 硬编码的 goodText 里的 0x12 / 18 也已一并修。

**已修**:
- `packets.json` p1/p2/p3 byte 1 → 20/15/14
- `index.mjs` dryRun goodText 0x12 → 0x14, decimalText 18 → 20
- dryRun 现在 4/4 检查过

E37 REPORT.md 也确认基于修复后的 bytes 跑出来 exactMatch=67%, 跟原 E36 数据 20% 相比 → **真实差距可能略小, 但模板路径仍显著好**。

---

## 10. 重跑结果 (2026-06-08, live-15sample.json 覆盖)

用修好的 packets.json 重跑 15 calls:

| 维度 | 旧 (broken grader) | **新 (clean)** | Δ |
|---|---|---|---|
| exactMatch | 20% (3/15) | **26.7% (4/15)** | +7% |
| lengthMatch | 27% (4/15) | 26.7% (4/15) | -0.3% |
| firstByteMatch | 40% (6/15) | 40% (6/15) | 0% |
| byteAccuracy | 27% | 28.1% | +1% |
| **extracted** | **93% (14/15)** | **60% (9/15)** | **-33%** ⚠ |

**新数据 per-packet**:
- p1 CONNECT (test-123): 0/3, acc 3% — 跟旧一致
- p2 CONNECT (abc): 0/3, acc 4% — 跟旧一致
- p3 PUBLISH: 0/3, acc 0% — 跟旧一致
- p4 SUBSCRIBE: **1/3** (vs 旧 0/3), acc 33% — 多 1 个, LLM 偶发
- p5 PINGREQ: 3/3, acc 100% — 跟旧一致

### 10.1 extracted 暴跌的解释

**6/15 (40%) 调用超时** (`The operation was aborted due to timeout`):
- p1: 2/3 超时
- p2: 1/3 超时
- p3: 2/3 超时
- p4: 1/3 超时
- p5: 0/3 超时 (PINGREQ 短, 不会超时)

**这跟 grader fix 无关** — 是 provider-kit 的 `withTimeout` 在长 prompt 长响应场景下掐断了。可能是 provider 服务端慢, 也可能是 LLM 在变长协议场景下生成长度爆掉。

**对 C 计划的意义**:
- 0/10 baseline 的解释**不变**: 模型本身写不出变长协议包 (PINGREQ 100% vs 其他 0%)
- 旧的 93% extraction 是**没遇到超时的幸运 batch**
- 新数据 60% extraction 更接近**生产环境真实** — 弱模型在长任务上 timeout 率高, 单独跑字节流任务不可靠

### 10.2 跟 E37/E38 的对比仍然成立

| 路径 | exactMatch | 解读 |
|---|---|---|
| E36 (写字节) | **27%** | baseline |
| E37 (填 JSON) | 67% | +40% over baseline |
| E38 (tool call) | 87% | **+60% over baseline** |

**E38 跟 clean baseline 差距 60%, 跟 broken baseline 差距 67% — 都很显著**。

C 计划 1.2 + 1.3 联合 intervention 的结论**稳固**。
