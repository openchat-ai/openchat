# Cap — M3 能力档位诊断

> 找 M3 真正的能力天花板。S/T/U 路线 S（诊断）的实验性扩展。

**假说**: 5 件套（窄 tool 集）的"100%"是协议包固定格式的天花板, 不是 universal scaffold。E49/E50 复杂 async 任务 M3 直接挂, 但"挂的原因"是黑箱。

**目标**: 量化 M3 在 5 档能力任务上的断点, 输出**失败原因谱** → 决定 T/U 路线走哪条。

## 1. 5 档能力矩阵

| 档 | 能力 | 状态 | 实验文件 | 通过率 |
|---|------|------|---------|--------|
| 1 | 纯数据查询 | ✅ | (38 原语已有) | ~100% |
| 2 | 协议包固定格式 | ✅ | (lingbao 原语 40-45) | 100% |
| 3 | 状态机 + 错误恢复 | 🔄 | `60.mjs` | **baseline 5/5** (理想 LLM) |
| 4 | 并发/竞态处理 | ⏳ | (待) | — |
| 5 | 长链路调试 | ⏳ | (待) | — |

**重要**: 60.mjs 的 5/5 是 **simulateIdealLLM** 的 baseline (硬编码"理想 LLM 行为"), 不是真实 M3。
真实 M3 跑同样的 5 task, 我们观察挂的方式 → 填 failure-taxonomy.json。

## 2. 档 3 任务清单 (60.mjs)

| # | task | 行为 | 期望 | 评估点 |
|---|------|------|------|--------|
| 1 | t1-flaky-success | 前 2 次 fail, 第 3 次 success | done, 3 attempts | 是否识别 transient, 继续 retry |
| 2 | t2-threshold-no-retry | 1 次 fail (threshold kind) | failed, 1 attempt | 是否区分 transient vs threshold |
| 3 | t3-always-fail-max | 永 fail (maxAttempts=3) | failed, 3 attempts | 是否无脑无限 retry |
| 4 | t4-fatal-no-retry | 1 次 fail (fatal kind) | failed, 1 attempt | 是否无脑 retry fatal |
| 5 | t5-mixed-kinds | transient→transient→threshold | failed, 3 attempts | 第 3 次能否正确判定 threshold |

## 3. 关键设计: tool 下沉 (U 假说)

`lib/retry-state.mjs` 是 U 假说的最小验证:
- LLM **不写**状态机, 只调 `recordAttempt({ ok, error, kind })`
- 状态机自己管: maxAttempts, delayMs, retry/throw 决策
- LLM 不知道当前 attempt 几次, 是否已到上限

**真 M3 测试设计**:
- 给 M3 同样的 5 task 描述 + retry-state tool 接口
- 让 M3 写"调用代码" (类似 E40 调 waveform-sim 那样)
- 对比 simulateIdealLLM 的 trace, 分类失败原因

## 4. 失败原因谱 (待填)

```jsonc
// failure-taxonomy.json
{
  "tier3": {
    "t1-flaky-success": {
      "ran_on_m3": null,        // true/false/null(未跑)
      "finalState": null,
      "attempts": null,
      "failureReason": null,    // 见下枚举
      "evidence": "log 文件路径"
    },
    // ...
  },
  "taxonomy": {
    "missing_await": "缺 await, Promise 链断",
    "state_loss": "状态丢失 (局部变量假设)",
    "race_deadlock": "并发死锁/竞态",
    "api_signature_guess": "API 签名猜错",
    "error_swallowed": "错误吞掉",
    "early_return": "早返回, 跳过 retry 逻辑",
    "infinite_retry": "无脑无限 retry, 忘 maxAttempts",
    "kind_confusion": "transient vs threshold vs fatal 混淆",
    "no_log_check": "从不调 getLog/describe 观察状态"
  }
}
```

## 5. 复现命令

```bash
# 跑 baseline (理想 LLM)
node -e "import('./bridge/src/experiments/cap/60.mjs').then(m => m.test())"

# 跑单 task
node -e "import('./bridge/src/experiments/cap/60.mjs').then(m => m.run({inputs:{taskId:'t1-flaky-success'}}).then(console.log))"

# 看 log
ls bridge/src/experiments/cap/logs/
```

## 6. 下一步 (S3 决策点)

档 3 跑完真实 M3 后:
- 若失败机制 ≤3 类且高频 → U 路线 (写专用 tool, 60.mjs 的 retry-state 已是雏形)
- 若失败机制 ≥4 类 → T 路线 (强模型/spec-driven/TDD 对比)
- 若 M3 在档 3 已 <30% → S/T/U 全废, 回退"窄 scaffold + 人工兜底"
