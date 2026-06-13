# spec: failure-analyzer

> lab P2 — 失败分类 + 决定能不能 auto-retry

## 数据流
1. runner.mjs 在子进程 exit / error 后拿到 `{exitCode, signal, error?}`
2. 调 `classify(runResult)` → `{category, reason, retryable}`
3. runner 据此决定: done / re-queue / escalate

## 接口签名
```js
classify(runResult: { exitCode, signal, error? }): Classification

Classification = {
  category: 'success' | 'transient' | 'code' | 'config' | 'unknown',
  reason: string,
  retryable: boolean,
}
```

## 分类规则
| 输入 | category | retryable | reason |
|------|----------|-----------|--------|
| `error` 非空 (spawn 失败) | `config` | false | `spawn error: <msg>` |
| `signal === 'SIGTERM'` | `transient` | true | `killed by SIGTERM (likely OOM / external kill / timeout)` |
| `signal === 'SIGKILL'` | `transient` | true | `killed by SIGKILL (...)` |
| `signal === 'SIGABRT'` | `transient` | true | `killed by SIGABRT (...)` |
| `exitCode === 0` | `success` | false | `exit 0` |
| `exitCode === null` 且无 signal | `unknown` | false | `no exit code or signal` |
| 其它 (exitCode 非 0) | `code` | false | `exit code N` |

## 决策记录
- **不分析 stderr 文本** — 留 P3, 跟 dashboard 一起 (e.g. rate limit / API key invalid)
- **SIGABRT 也算 transient** — node 自己 abort (assert fail) 也可能, 但有时是 OOM, 默认重试
- **exit 137/143 (kill 9/15 的 shell code) 走 code 而非 transient** — 因为没看到 signal, 是子进程自己返的码
- **config 不重试** — 同样的 spawn 错误重试 N 次也是挂, 不浪费
- **unknown 不重试** — 防御: 看不懂就别试

## 边界条件
- classify 是纯函数, 不读文件不调外部, 易测
- reason 字段直接显示给用户, 要可读 (不暴露内部 trace)

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/lab/failure-analyzer.mjs` | classify | 50 |

## 不做
- stderr 文本解析 (e.g. 抓 "rate limit" / "401" / "timeout") — 留 P3
- 错误堆栈聚合 (same error N 次) — 留 P3 dashboard
- 失败 experiment 自动隔离 (e.g. code 失败就停跑同类) — 留 P2 续
