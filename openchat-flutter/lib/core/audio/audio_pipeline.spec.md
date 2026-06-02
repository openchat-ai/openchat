# spec: Audio Pipeline

> 音频前处理管线：高通滤波 → RNNOISE 模拟降噪 → AGC → VAD。
> 使用 `dart:math` 标准库，移除手写 `_sqrt/_pow/_exp/_ln`。

## 数据流

```
PCM s16le → processFrame
  → HighPass (80Hz RC filter)
  → RNNoise (noise estimation + spectral reduction, mock mode)
  → AGC (target RMS=8000, max gain=10x)
  → VAD (energy + zero-crossing threshold)
  → ProcessedFrame (data + isSpeech + probability)
```

## 接口签名

```dart
class AudioPipeline {
  final int sampleRate;
  final int channels;
  final int frameSize;

  AudioPipeline({this.sampleRate = 24000, this.channels = 1, this.frameSize = 480});
  Future<void> initialize();
  bool get rnnoiseReady;
  Future<ProcessedFrame> processFrame(Uint8List pcmData);
  AudioPipelineStats getStats();
  void destroy();
}

class ProcessedFrame {
  Uint8List data;
  final int timestamp;
  double? vad;
  bool? isSpeech;
  double? speechProbability;
  ProcessedFrame({required this.data, required this.timestamp});
}

class AudioPipelineStats {
  final int totalFrames, speechFrames, noiseFrames;
  final String speechRatio, totalSpeechTime;
  final bool vadEnabled, rnnoiseEnabled, rnnoiseReady;
  final String rnnoiseAvgTime;
  AudioPipelineStats({required this.totalFrames, ...});
}

// 私有内部类 (在 audio_pipeline.dart 中)
class _RNNoiseResult { final Uint8List data; final double vad; }
class _VADResult { final bool isSpeech; final double probability; }
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 全零 PCM (静音) | 能量 < 300 → VAD isSpeech=false, probability=0 |
| 纯正弦波 1kHz | VAD 判断为语音 (energy 高, ZCR 适中) |
| 输入为空 | _calculateRMS 除数=0 → sqrt(0)=0 → rms/32768 clamp 到 0 |
| 直流偏置 | ZCR < 8 → VAD isSpeech=false, probability=0.1 |
| AGC 增益 >10x | 最终 clamp 到 10x |
| Noise reduction factor | reduction=(noiseLevel*0.5).clamp(0,0.8) → factor=1-reduction*0.3 |
| HighPass 系数 | rc=1/(2π·80), alpha=rc/(rc+dt), 输出=α·prev+(sample-prev)·α |

## 文件清单

| 文件 | 职责 | 行数上限 | 实际行数 |
|------|------|---------|---------|
| `audio_pipeline.dart` | AudioPipeline 类 | 200 | 270 |
| `audio_models.dart` | ProcessedFrame + AudioPipelineStats | 40 | 35 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C7 | `[C7] pipeline frame` | processFrame | `pipeline frame in=N out=N vad=X speech=Y` |

> 当前实现未实际输出 C7 标记 (无该日志行)。建议添加。

## 不变量 (invariants)

```
// === invariants ===
// - 所有数学函数使用 dart:math (sqrt/pow/exp/log)
// - RNNOISE 为 mock 模式，不做真实降噪
// - VAD 阈值 (minEnergy=300, maxZCR=80) 为硬编码常量，不动态调整
// - destroy() 后 processFrame 仍然可以调用（残留 state 不清理）
// - _RNNoiseResult 和 _VADResult 为私有类，外部不可见
```
