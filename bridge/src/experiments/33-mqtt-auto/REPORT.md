# E33 vs 0/10 Baseline — 对比报告

> 写于 2026-06-08

## 1. 一句话结论

**E33 (33-mqtt-auto) 是人工写的 MQTT 3.1.1 客户端, 比 0/10 报告里的"平台基线 31-mqtt-adapter"更强**。但它只证明了"scaffold 给人用是有效的", 没有证明"LLM 能自己写出 E33"。

## 2. 规模对比

| 指标 | 31-mqtt-adapter (已删) | E33 (33-mqtt-auto) |
|---|---|---|
| 文件 LOC | 143 | 433 |
| exports | 7 | 多个 (mqttConnect / mqttSubscribe / mqttPublish / mqttPingreq / mqttDisconnect) |
| TOOLS 数组 | 8 entries | (无, 是 callable exports 不是 tool schema) |
| executeTool | ✅ | (无) |
| test 断言 | 15 | 11 |
| test 块 (═══) | 8 | 11 |
| mock broker | ✅ | ✅ |
| test 退出 | 0 | 0 |

## 3. MQTT 特性覆盖 (vs 0/10 报告里的特性矩阵)

```
                          31-mqtt-adapter     E33 (33-mqtt-auto)
CONNECT (0x10)            ✅                  ✅
CONNACK parse             ✅                  ✅ (含 refused code 5)
SUBSCRIBE (0x82)          ✅                  ✅
SUBACK handling           ❌                  ✅ (mqttSubscribe 等 SUBACK 后 resolve)
PUBLISH (0x30)            ✅                  ✅
PUBLISH parse             ✅                  ✅
DISCONNECT (0xE0)         ✅                  ✅
PUBACK                    ❌                  ✅ (QoS 1 publish 完成 = 收到 PUBACK)
PINGREQ                   ❌                  ✅ (独立 mqttPingreq 函数)
Variable length encode    ✅                  ✅
Multi-topic (Map)         ✅                  (无, 单 topic)
Reconnect                 ✅                  ✅
TLS support               ❌                  ❌
Will flag (0x04)          ❌                  ❌
Username/password         ❌                  ❌
                          ─────────           ─────────
                          9/14                11/14 (+2)
```

E33 **多 2 个特性**: SUBACK handling, PUBACK, PINGREQ (3 个). 但少了 Multi-topic。

## 4. E33 解决了 0/10 报告里的哪些问题

0/10 报告里**人写**的部分 (31-mqtt-adapter) 跟 E33 一样都通过了 test。E33 的"增强"主要在:

1. **独立的 PINGREQ / PINGRESP 路径** — 0/10 报告里没有测试 keepalive, E33 显式 `mqttPingreq(sess)` + wait
2. **PUBACK 等待** — QoS 1 publish 等收到 PUBACK 才 resolve, 避免"假成功"
3. **错误码透传** — `CONNACK refused: code=5` 透传到 caller, 不是吞掉
4. **dead session 显式报错** — `session not alive`, 不是 undefined behavior
5. **unreachable 处理** — `connect ECONNREFUSED 127.0.0.1` 显式 catch
6. **empty onClose handler 不崩** — 测试覆盖空 callback 边界

这些是 "**写好一个协议客户端需要的小细节**" — 0/10 报告没要求, E33 自发加上了。

## 5. E33 没有证明什么 (跟 C 计划相关)

### 5.1 跟"LLM 自主创建"无关

E33 是**人用 scaffold 写出来的**。它只证明:
- scaffold 的工具链 (read_file, write_file, grep, ast 等) 给人用是够的
- Node.js `net` 模块能用来写协议客户端
- 测试模式 (mock broker + assert) 跑得通

它**不证明**:
- LLM (minimax/M3) 能自己写出 E33 → 这是 0/10 baseline 测的
- scaffold 的工具能驱动 LLM 完成"多步骤、多文件、需要测试反馈"的复杂任务
- 弱模型 (minimax/M3) 在加了 E34/E35 改造后能写出 E33

### 5.2 跟"生产可用"无关

E33 的限制:
- **mock broker**, 没接真 broker (test.mjs 里 `127.0.0.1:1883` 连接拒绝 = 正常)
- **packet ID 写死 1** — 多订阅会冲突 (mqttSubscribe 写死 `pktId = 1`, mqttPublish 写死 `pktId = 1`)
- **无 TLS**, 无 username/password, 无 Will flag
- **无 reconnect 重试退避**

要把 E33 当生产用, 至少需要:
- packet ID 分配器 (单调递增, 用 1-65535 循环)
- TLS support (Node.js `tls` 模块)
- 重试退避 (exponential backoff)
- Will flag
- Username/password
- 真实 broker 集成测试 (用 mqtt.js reference client 对照)

### 5.3 跟"协议完整性"无关

MQTT 3.1.1 规范要求:
- **QoS 2**: exactly-once delivery, 4 次握手 (PUBREC/PUBREL/PUBCOMP). E33 没实现
- **Retain**: PUBLISH retain flag. E33 没处理
- **Topic wildcards**: `+` 和 `#`. E33 单 topic 透传
- **Session state**: 客户端需要记住 subscription, 重连后恢复

E33 实现了 MQTT 的"happy path", 缺了 QoS 2/Retain/Wildcard 这 3 个关键维度。

## 6. 跟 C 计划的关系

| C 计划项 | E33 提供的证据 |
|---|---|
| 1.1 schema strictness | 无关 (E33 是人写的, 没用 LLM) |
| 1.2 narrow tools | 无关 |
| 1.3 protocol-template | **强相关** — E33 的"成功骨架" = template 库的参考实现 |
| 2.1 template lib | E33 的 wire helpers (encLen, wstr, wrem, drem) 可直接抽成 template |
| 2.2 verify-loop | **相关** — E33 的 test.mjs 就是"verify-loop"想要的内置测试 |
| 3.1 goal-decompose | 无关 |
| 3.2 quality gate | **相关** — E33 的 module-load test 是质量门的一例 |
| 3.3 复跑 0/10 基准 | E33 是**目标** (我们希望 LLM 能写出 E33) |

**结论**: E33 是"人 + scaffold"的产出上限。如果 LLM 自主创建实验的产出能达到 E33 的 80%, C 计划就成功了。

## 7. 复跑指令

```bash
# 跑 E33 完整测试 (11 个断言, mock broker, 1 秒跑完)
node bin/exp.mjs 33-mqtt-auto

# 看 E33 源码
cat src/experiments/33-mqtt-auto/index.mjs
```
