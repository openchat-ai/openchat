# spec: LMDN Audio Codec

> MDCT-based audio codec with adaptive bit allocation + F0 extraction.
> Split from single 671-line file into 7 single-responsibility files (R6).

## 数据流

```
PCM s16le → LmdnCodec.encode
  → MDCT (pre-computed tables)
  → adaptive bit allocation per band
  → F0 fusion (YIN + PeakTrack) → 20bits/4frames metadata
  → BitWriter → LMDN frame (0xBB 0x01 0xCC header)

LMDN frame → LmdnCodec.decode
  → frame detection + BitReader
  → IMDCT + overlap-add
  → F0 metadata extraction → ScoreNote list
  → PCM s16le output
```

## 接口签名

```dart
// lmdn_models.dart — 纯数据类，无逻辑
class LmdnEncoded { final Uint8List data; final int frameCount; }
class LmdnDecoded { final Uint8List pcm; final int decodeTime; final List<ScoreNote> notes; }
class ScoreNote { final int midi; final double startSec; final double durSec; }
class ProcessedAudioResult { final Uint8List pcm; final List<ScoreNote> notes; }

// lmdn_mdct.dart — 纯函数，无状态
void initMdctTables();                         // 惰性初始化 MDCT 窗口/系数表
Float64List mdct(Float64List x);               // 前向 MDCT (2N→N)
Float64List imdct(Float64List X);              // 反向 MDCT (N→2N)
void fft(Float64List re, Float64List im);       // 原地基-2 FFT

// lmdn_f0.dart — 纯函数，无状态；sr 参数替代全局常量
Map<String, dynamic>? yinF0(Float64List samples, {int sr = 48000});
Map<String, dynamic>? peakTrackF0(Float64List samples, {int sr = 48000});
Map<String, dynamic>? fusionF0(Float64List samples, {int sr = 48000});

// lmdn_bitio.dart — 纯 IO 类
class BitWriter { void write(int v, int bits); Uint8List finish(); }
class BitReader { int read(int bits); }

// lmdn_codec.dart — LmdnCodec 类，编码/解码核心
class LmdnCodec {
  final int sampleRate;                         // 48kHz 默认，支持任意 sr
  LmdnCodec({this.sampleRate = 48000});
  int get samplesPerFrame;
  Future<void> initialize();
  Future<LmdnEncoded> encode(Uint8List pcmData);
  Future<LmdnDecoded> decode(Uint8List data);   // _prevY 跨调用持久（不再重置）
  void reset();                                  // 清空 _prevY + _bits（新流）
  Map<String, dynamic> getStats();
  void destroy();
}

// lmdn_config.dart — 配置，从七牛加载
class LmdnConfig {
  int get sampleRate, bufferMs, pollMs, fadeBytes, fadeSamples, bufferBytes, demoDelayMs;
  bool get denoise, agc, highPass;
  static Future<LmdnConfig> load();             // 从 oc/config/audio.json 加载
}

// lmdn_processor.dart — 编排 codec + pipeline
class LmdnProcessor {
  Stream<bool> get speakingEvents;
  Stream<double> get audioLevel;
  Future<void> initialize();
  Future<Uint8List?> processMicrophoneInput(Uint8List pcmData);
  Future<ProcessedAudioResult?> processReceivedAudio(Uint8List data);
  void resetCodec();                            // 转发到 LmdnCodec.reset()
  Map<String, dynamic> getStats();
  void dispose();
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| 空 PCM 输入 (0 bytes) | encode 返回空 LMDN 帧，不崩溃 |
| 短 PCM (<1 frame) | encode 返回最小帧，无 F0 |
| 非 LMDN 数据 | decode 抛出异常 'No decodable LMDN frames found' |
| 多段 concat LMDN (EPC) | decode 逐段处理并拼接 PCM |
| 任意 sr 构造 | 构造函数接受任意 sr（默认 48000），MDCT N=96 不变 |
| 并发 encode/decode | 不锁，调用方保证串行 |
| init 前调用 encode | throw Exception('Codec not initialized') |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `lmdn_models.dart` | 4 个数据容器类 | 40 |
| `lmdn_mdct.dart` | MDCT 表 + FFT 纯函数 | 100 |
| `lmdn_f0.dart` | YIN + PeakTrack + fusion F0 | 100 |
| `lmdn_bitio.dart` | BitWriter + BitReader | 50 |
| `lmdn_codec.dart` | LmdnCodec 编码/解码核心 | 200 |
| `lmdn_config.dart` | LmdnConfig 配置加载 | 50 |
| `lmdn_processor.dart` | LmdnProcessor 编排 | 80 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C4 | `[C4] encode` | lmdn_codec:encode | `encode in=N frames=N out=M` |
| C5 | `[C5] decode` | lmdn_codec:decode | `decode frames=N pcm=M time=Tms notes=K` |
| C6 | `[C6] f0` | lmdn_f0:fusionF0 | `f0=HZ conf=C` |

## 不变量 (invariants)

```
// === invariants ===
// - MDCT 表在第一次 initMdctTables() 时计算，之后恒为常量
// - LmdnCodec 内部 _bits 在首次 encode 时按信号自适应分配，之后冻结
// - _prevY 跨 decode 调用持久，确保 TDAC 连续性；独立流前需 reset()
// - F0 提取为纯函数，不修改全局状态；sr 参数控制频率计算精度
// - 仅 N=96 受支持（MDCT 表大小）；sampleRate 可任意
```
