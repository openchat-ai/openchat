# spec: signal-algo lib (41 子模块)
> 41.mjs 的算法后端：互相关/FFT/漏电检测/电弧能量。纯 JS 零依赖。

## 数据流
```
外部输入: Float32Array 波形
   ↓
fft(crossCorrelate(detectLeak(arcEnergy(...))))
   ↓
返回 { result, confidence, isArc, ... }
```

## 接口签名
```ts
fftOnSamples(samples: Float32Array): { real, imag, magnitudes, peakFreq }
crossCorrelate(a, b, maxLag?): { lag, peak, confidence }
detectLeak(samples, sampleRate, thresholdMa?): { triggered, startIdx, endIdx, peakMa }
arcEnergy(samples, sampleRate, bandHz?): { energy, totalEnergy, ratio, isArc }
```

## 边界条件
- `samples.length < 64` → `RangeError`
- `crossCorrelate` 两数组必须等长
- FFT 自动补零到 2 的幂
- `detectLeak` 阈值默认 30mA
- `arcEnergy` 默认频段 8-12kHz
- ratio > 0.15 → isArc

## 文件清单
| 文件 | 职责 | 行数 |
|---|---|---|
| `bridge/src/experiments/lingbao/lib/signal-algo.mjs` | 本模块 | 145 |

## 调试检查点
| C | 关键词 | 预期 |
|---|---|---|
| C1 | `fft` 递归调用 | 长度补零到 2^k |
| C2 | `crossCorrelate` 输出 lag | 整数 |
| C3 | `arcEnergy.ratio` | 浮点 |

## 不变量
```js
// === invariants ===
// - FFT: Cooley-Tukey 递归, O(N log N)
// - crossCorrelate 归一化到 [-1, 1]
// - arc: 8-12kHz/总能量 > 0.15 → isArc
// - detectLeak 步长 = sr/100 (10ms 窗)
// - 全部纯函数, 无副作用
```
