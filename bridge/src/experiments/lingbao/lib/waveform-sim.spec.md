# spec: waveform-sim lib (40 子模块)
> 漏电波形合成算法实现。40.mjs 的算法后端，无外部依赖。

## 数据流
```
generate({ durationMs, leakStartMs, leakLevelMa, scenario, noiseDb, sampleRate })
  ↓
逐 sample 计算: 50Hz 基波 + 漏电谐波 + arc 高频 + 高斯白噪声
  ↓
返回 { samples: Float32Array, leakDetected, stats }
```

## 接口签名
```ts
function generate(opts: {
  durationMs: number,
  leakStartMs?: number,    // 默认 0
  leakLevelMa?: number,    // 默认 0
  scenario?: 'normal' | 'leak' | 'arc' | 'overload',
  noiseDb?: number,        // 默认 -40
  sampleRate?: number,     // 默认 12800
  mainsFreq?: number,      // 默认 50
}): {
  samples: Float32Array,
  sampleRate: number,
  leakDetected: boolean,
  stats: { peak: number, rms: number, totalSamples: number, scenario: string }
}
```

## 边界条件
- `durationMs < 50` → `RangeError`
- `leakLevelMa < 0` → `RangeError`
- `sampleRate ∉ [8000, 48000]` → `RangeError`
- `leakDetected` 判定: `leakLevelMa > 30` (30mA 阈值)
- 输出数组长度 = `floor(sampleRate * durationMs / 1000)`

## 文件清单
| 文件 | 职责 | 行数 |
|---|---|---|
| `bridge/src/experiments/lingbao/lib/waveform-sim.mjs` | 本模块 | 85 |

## 调试检查点
| C | 关键词 | 预期 |
|---|---|---|
| C1 | `generate` 入口 | 校验参数 |
| C2 | `injected = true` | 漏电已注入 |
| C3 | 返回 stats | 包含 peak/rms |

## 不变量
```js
// === invariants ===
// - sampleRate 默认 12800
// - 漏电 mA → 电压: V = mA / 30 (CT 变比假设)
// - 输出长度 = floor(sr * dur / 1000)
// - 噪声用 Box-Muller (无 seed = 非确定性, 每次跑不同)
// - scenario='arc' 注入 8kHz + 12kHz 高频分量
// - scenario='overload' 基波 × 1.5
```
