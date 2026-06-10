# spec: failover-picker

> 运行时降级链选择器，替代 dev-repl 里 `createProvider+connect` 试错（每次失败等 5-10s）

## 数据流
1. 接收 `fallbacks: [{name, model}, ...]` + `cfg`
2. 对每个候选调 `provider-health.pingProvider(name, pcfg, {timeoutMs:3000})`
3. 首个 `ping.ok === true` 的候选 → 调 `createProvider+connect`
4. 全部失败 → 返回 `{ok:false, tried:[], fix}`

## 接口签名
```js
pickFirstAlive(fallbacks, cfg, { silent?, timeoutMs? })
  → Promise<{
      ok: boolean,
      provider?: object,         // createProvider 返回的实例
      label?: string,            // 'openai/gpt-4'
      pickedFrom?: string,       // 选中的 provider name
      tried: Array<{ name, model, ping: { ok, status, latencyMs, error? }, connectError? }>,
      fix?: string
    }>
```

## 边界条件
- 降级链为空 → `{ok:false, tried:[], fix:'...'}`
- 候选缺 apiKey (非 skipAuth) → ping 跳过, 标 `no-api-key`
- 候选缺 baseUrl → ping 跳过, 标 `no-baseurl`
- 端点 5xx/timeout → 标 alive=false, 试下一个
- 端点 alive=true 但 connect 失败 (key 过期 / 模型列表 404) → 标 `connectError`, 试下一个
- silent=true 不打 stdout (供测试)
- 全部失败 → tried 全有记录, fix 字符串

## 文件清单
| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `bridge/src/experiments/lib/failover-picker.mjs` | 选首个 alive | 100 |
| `bridge/src/experiments/lib/provider-health.mjs` | 暴露 `pingProvider(name, pcfg, opts)` | (改 1 处 +20 行) |
| `bridge/src/experiments/lib/dev-repl.mjs` | 启动时 + 运行时切都用 picker | (改 2 处) |

## 调试检查点
| C | grep 关键词 | 预期 |
|---|-------------|------|
| C1 | `[failover] X 存活` | 命中 |
| C2 | `[failover] X 不可达` | 跳过 |
| C3 | `[failover] X: 缺 apiKey` | 跳过 |
| C4 | `[failover] X 存活, 正在 connect...` + `✓` | 启动成功 |

## 不变量
- 真 ping 永不抛
- 硬超时 3000ms (可配, 上限 10000)
- 只对首个 alive 调 createProvider+connect
- 不写盘
- silent 控制 stdout
