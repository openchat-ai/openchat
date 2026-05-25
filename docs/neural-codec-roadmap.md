# Neural Codec 升级路线 — 乐器音色 + 乐谱重合成

## 目标

当前 `neural_audio_codec.dart` 是特征参数合成器（5 正弦波）。迭代目标是：**编码端提取乐器音色/乐谱/瞬态，解码端高质量重合成**。

## E1 — 当前链路修复（进行中）

- WAV 头拼接 bug 修复 → 纯 PCM 传输，收端单次裹头
- AudioProcessor 接入验证 → RNNoise + Codec 全链路 CI 通过
- AudioMode.raw 支持（绕过 codec，直传 PCM 用于高音质场景）
- VAD/AGC 拆除（无消费者）

## E2 — 合成器升级（下一步）

| 当前 | 目标 |
|------|------|
| 5 固定正弦波（100-1600Hz） | 32 频段滤波器组（0-12kHz） |
| Sub-band → 单个正弦振幅 | Sub-band → 滤波器组增益向量 |
| 每帧 9 字节 | 每帧 32+ 字节（码率升但音质飞跃） |

编码端：仍提取 32 子带能量，但解码端用**时变滤波器**而非正弦波合成。

## E3 — 瞬态编码

音乐信号中最难编码的是瞬态（鼓点、拨弦、音头）。当前正弦合成完全丢失。

方案：编码端检测 onset（瞬态起点），单独编码瞬态层（时域脉冲 + 频谱形状），解码端叠加到滤波合成输出上。

## E4 — 音色模型

为常见乐器建立码本：
1. 编码端：识别乐器类别（聚类子带能量分布）
2. 传输：音色索引（4-8bit）+ 基频 + 能量包络
3. 解码端：用码本音色 + 传输参数重合成

## E5 — Source Separation

编码端用简单分离（谐波-打击乐分解 HPSS）将音频拆为：
- 人声/旋律层 → E4 音色模型编码
- 打击乐层 → E3 瞬态编码
- 背景层 → E2 滤波器合成

## E6 — 乐谱表示

加入基频追踪（PYIN/自相关）：
- 编码端：F0 序列 + 音符起止 + 力度
- 传输：MIDI 级乐谱（~1kbps）
- 解码端：可用任意音色演奏乐谱（音色+乐谱分离）

## E7 — 端到端神经网络

替换整个编解码为预训练模型：
- **EnCodec** (Meta, 1.5-24kbps)
- **DAC** (Descript, 8-32kbps)
- 手机 NPU 推理（Qualcomm SNPE / MediaTek NeuroPilot）

## 文件结构

```
openchat-flutter/lib/core/audio/
├── neural_audio_codec.dart      ← 当前合成器 → E2 升级
├── audio_pipeline.dart           ← 保留 RNNoise + 高通
├── audio_processor.dart          ← 统一入口
├── synth/
│   ├── filter_bank.dart          ← E2: 滤波器组合成
│   ├── transient_layer.dart      ← E3: 瞬态层
│   ├── timbre_codebook.dart      ← E4: 音色码本
│   └── score_encoder.dart        ← E6: 乐谱编码
└── separation/
    ├── hpss.dart                 ← E5: 谐波-打击乐分离
    └── source_encoder.dart       ← E5: 多源编码
```
