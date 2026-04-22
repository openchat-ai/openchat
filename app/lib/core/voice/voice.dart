/// 语音核心模块
///
/// 集成 RNNoise WASM 降噪引擎
///
/// 使用示例:
/// ```dart
/// import 'package:openchat/core/voice/voice.dart';
///
/// final voiceService = VoiceService();
/// await voiceService.initialize();
/// await voiceService.joinRoom(VoiceRoom(id: 'room1', name: '语音房间'));
///
/// // PTT 模式
/// voiceService.startSpeaking();
/// // ... 说话
/// voiceService.stopSpeaking();
/// ```
///
/// 核心组件:
/// - [RNNoiseProcessor] - RNNoise WASM 降噪处理器
/// - [AudioPipeline] - 音频采集与处理管道
/// - [VoiceService] - 高层语音服务
/// - [PushToTalkButton] - PTT 按钮 Widget
/// - [VoiceWaveform] - 语音波形可视化

library voice;

export 'rnnoise_processor.dart';
export 'audio_pipeline.dart';
export 'voice_service.dart';
