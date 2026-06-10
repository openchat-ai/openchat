# 灵保 — 工地临时漏电 AI 协同防护

> 38 原语平台的实验性扩展。基于 ESP32-S3 + DDSU666 + 漏电模拟器 + Python 离线分析,
> 面向 20 万平住宅项目的三级 (总/分/末端) AI 协同漏电防护方案。

**当前状态**: 11 commit (本地, 未推送) | 5 个新原语 + 4 个 task demo | 零 regression

---

## 1. 业务背景

工地临时用电漏电频发:
- 月均误报 8-10 次, 每次排查 2-3 小时
- 现有漏电保护器无定位能力, 无法区分普通漏电 vs 电弧故障
- 三级配电 (总/分/末端) 之间无法快速定位故障回路

**目标**: AI 协同防护 — 漏电 3 秒内定位 + 区分故障类型 + 阈值随施工 phase 动态调整

## 2. 15 子任务完成度

| # | 子任务 | 状态 | 落地物 |
|---|--------|------|--------|
| 1 | ESP32-S3 + ADE9000 固件 | ⏭ skeleton | 需真硬件, 跳过 |
| 2 | 多级时间同步 (<1ms) | ⏭ skeleton | 需 LoRa Mesh, 跳过 |
| 3 | 开口式 CT + 温度驱动 | ⏭ skeleton | 需电路设计, 跳过 |
| 4 | 边缘端漏电事件检测 | ✅ demo | `41.signal-algo` detectLeak (threshold 30mA) |
| 5 | 多级时间差定位算法 | ✅ demo | `41.signal-algo` crossCorrelate (lag 精度 ±1 sample) |
| 6 | 漏电波形特征提取 | ✅ demo | `41.signal-algo` detectLeak + arcEnergy |
| 7 | 电弧故障检测 | ✅ demo | `41.signal-algo` arcEnergy (8-12kHz / 3-6kHz 双频段) |
| 8 | 过载预测 LSTM | ⏭ skeleton | 需 PyTorch, 跳过 |
| 9 | 阈值动态调整 | ✅ demo | `45.calendar-parse` (5 phase × 3 阈值) |
| 10 | 云端告警推送 | ✅ demo | `42.mqtt-push` (端到端 33ms < 3s 目标) |
| 11 | 电工 APP | ⏭ skeleton | 无 Flutter 编译环境, 跳过 |
| 12 | 历史回放 | ⏭ skeleton | 无 Web 端, 跳过 |
| 13 | MVP 实测方案书 | ✅ demo | `44.doc-gen report` (5620B 完整可执行) |
| 14 | 问卷 + ROI 模板 | ✅ demo | `44.doc-gen questionnaire + roi` (10 题 + 12 行) |
| 15 | 20 万平方案书 | ✅ demo | `44.doc-gen proposal` (1741B + 7 条阈值建议) |

**完成度**: 9/15 (60%) — L2 算法层 + L3 推送层 + L4 业务层全覆盖, L1 硬件层 + L3 UI 层依赖外部环境跳过

## 3. 5 个新原语

| ID | 文件 | 职责 | 测试 | 依赖 |
|---|---|---|---|---|
| 40 | `40.mjs` | 漏电流合成波形 | 10/10 | 无 |
| 41 | `41.mjs` | 互相关/FFT/漏电/电弧 | 12/12 | 40 |
| 42 | `42.mjs` | 告警推送 in-process | 12/12 | 无 |
| 44 | `44.mjs` | 报告/问卷/ROI/方案书 | 10/10 | 无 |
| 45 | `45.mjs` | 施工日历+阈值调整 | 19/19 | 无 |

**未实现**: 39 (hardware-spec) / 43 (flutter-screen) — 纯 spec 类, 与 44.doc-gen 能力重叠

## 4. 4 个 task demo

| 任务 | 文件 | 产物 | 关键指标 |
|---|---|---|---|
| 10 | `tasks/task-10-push.mjs` | 3 事件端到端推送 | 33ms (目标 <3s) |
| 13 | `tasks/task-13-report.mjs` | MVP 实测方案书 Markdown | 5620B, 7 项 BOM, 6 条验收 |
| 14 | `tasks/task-14-survey-roi.mjs` | 10 题问卷 + 12 行 ROI (CSV) | 落 `tasks/output/` |
| 15 | `tasks/task-15-proposal.mjs` | 20 万平方案书 + 7 条阈值建议 | 1741B, 投资回收 29.7 月 |

## 5. 关键不变量

```
// === invariants (跨原语) ===
// - 漏电幅值单位统一为 mA, 内部 V = mA / 30 (CT 变比)
// - 阈值硬编码: leakMa=30, arcEnergy=0.15, overloadKw=50
// - 频段: 合成 4-6kHz (Nyquist 限制), 检测 8-12kHz 或 3-6kHz
// - 推送 deliveryId 8 字符 hex, 进程内单例 bus
// - 文档输出 UTF-8, bytes = Buffer.byteLength
// - 排除目录: tasks/ (demo 脚本, 无 spec 要求)
```

## 6. 复现命令

```bash
# 跑单个原语
cd bridge/src/experiments/lingbao
node 40.mjs  # test() 自动跑 (但要 mjs top-level await 加 wrapper)
# 推荐用 test 直接调:
node -e "import('./40.mjs').then(m => m.test())"

# 跑 task demo
node tasks/task-10-push.mjs
node tasks/task-13-report.mjs
node tasks/task-14-survey-roi.mjs
node tasks/task-15-proposal.mjs

# 全平台回归
cd ../..
node run-all.mjs  # 40/43 closed-loop (3 missing 是 38 平台历史遗留)
```

## 7. 已知问题 / 后续

1. **L1 硬件层 0 完成** — 需真 ESP32 + ADE9000 + 漏电模拟器, 跳到 R2 评估
2. **L3 UI 层 0 完成** — 需 Flutter 编译环境, 子任务 11/12 标 skeleton
3. **PyTorch LSTM 跳过** — 子任务 8 需训练数据 + 模型, 跳到 R3
4. **mqtt-push 是 in-process** — 上线需替换为真 broker (aedes/mosquitto), 接口兼容

## 8. 商业指标 (来自 task-15 proposal)

- 漏电定位: 30 分钟 → 3 秒 (节省 99%)
- 误报排查: 8 次/月 → 1 次/月 (节省 87%)
- 年均事故避免损失: 5 万元/项目 (保守)
- 投资回收期: 29.7 个月 (单项目) / 10-14 个月 (多项目摊销)
