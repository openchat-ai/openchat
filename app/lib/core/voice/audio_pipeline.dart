/// 音频处理管道
///
/// 管理音频采集 → RNNoise降噪 → 编码 → 传输 的完整流程

import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'rnnoise_processor.dart';

/// 音频管道状态
enum AudioPipelineState {
  idle,
  initializing,
  ready,
  capturing,
  error,
}

/// 音频配置
class AudioConfig {
  final int sampleRate;
  final int channels;
  final int frameSizeMs;
  final bool enableNoiseSuppression;
  final bool enableAutoGain;
  final bool enableEchoCancellation;

  const AudioConfig({
    this.sampleRate = 48000,
    this.channels = 1,
    this.frameSizeMs = 10,
    this.enableNoiseSuppression = true,
    this.enableAutoGain = true,
    this.enableEchoCancellation = true,
  });

  static const AudioConfig default_ = AudioConfig();
  static const AudioConfig highQuality = AudioConfig(
    sampleRate: 48000,
    enableNoiseSuppression: true,
    enableAutoGain: true,
    enableEchoCancellation: true,
  );
  static const AudioConfig lowLatency = AudioConfig(
    sampleRate: 48000,
    frameSizeMs: 10,
  );
}

/// 音频帧事件
class AudioFrameEvent {
  final Uint8List data;
  final int timestamp;
  final double voiceProbability;
  final bool isVoice;

  AudioFrameEvent({
    required this.data,
    required this.timestamp,
    this.voiceProbability = 1.0,
    this.isVoice = true,
  });
}

/// 音频处理管道
class AudioPipeline with ChangeNotifier {
  final AudioConfig config;
  final RNNoiseProcessor _noiseProcessor;

  AudioPipelineState _state = AudioPipelineState.idle;
  MediaStream? _localStream;
  MediaStreamTrack? _audioTrack;

  final StreamController<AudioFrameEvent> _audioStreamController =
      StreamController<AudioFrameEvent>.broadcast();

  Stream<AudioFrameEvent> get audioStream => _audioStreamController.stream;
  AudioPipelineState get state => _state;
  bool get isCapturing => _state == AudioPipelineState.capturing;

  AudioPipeline({
    this.config = AudioConfig.default_,
  }) : _noiseProcessor = RNNoiseProcessor();

  /// 初始化管道
  Future<bool> initialize() async {
    if (_state == AudioPipelineState.ready) return true;

    _state = AudioPipelineState.initializing;
    notifyListeners();

    try {
      // 初始化 RNNoise
      final noiseOk = await _noiseProcessor.initialize();
      if (!noiseOk) {
        debugPrint('RNNoise 初始化失败，使用回退模式');
      }

      // 获取麦克风权限
      final stream = await navigator.mediaDevices.getUserMedia({
        'audio': {
          'echoCancellation': config.enableEchoCancellation,
          'noiseSuppression': false, // 我们用 RNNoise 替代浏览器内置降噪
          'autoGainControl': config.enableAutoGain,
          'sampleRate': config.sampleRate,
          'channelCount': config.channels,
        },
        'video': false,
      });

      _localStream = stream;
      _audioTrack = stream.getAudioTracks().firstOrNull;

      _state = AudioPipelineState.ready;
      notifyListeners();
      return true;
    } catch (e) {
      debugPrint('音频管道初始化失败: $e');
      _state = AudioPipelineState.error;
      notifyListeners();
      return false;
    }
  }

  /// 开始采集
  Future<void> startCapture() async {
    if (_state != AudioPipelineState.ready) {
      if (!await initialize()) return;
    }

    if (_audioTrack == null) return;

    _state = AudioPipelineState.capturing;
    notifyListeners();

    // WebRTC 音频处理
    // 实际实现需要通过 AudioContext 或 WebRTC 的 AudioWorklet
    // 这里是框架代码
    debugPrint('音频采集已启动');
  }

  /// 停止采集
  void stopCapture() {
    if (_state != AudioPipelineState.capturing) return;

    _state = AudioPipelineState.ready;
    notifyListeners();
    debugPrint('音频采集已停止');
  }

  /// 处理音频数据 (供外部调用)
  AudioFrameEvent processAudioData(Uint8List rawData, int timestamp) {
    // 转换为 Float32
    final int16Data = Int16List.view(rawData.buffer);
    final frame = AudioFrame.fromInt16(int16Data, timestamp);

    // RNNoise 处理
    final result = _noiseProcessor.processFrame(frame.samples);

    // 转换回 Uint8
    final processedInt16 = Float32List.fromList(result.processedSamples);
    final outputBytes = Uint8List.view(processedInt16.buffer);

    return AudioFrameEvent(
      data: outputBytes,
      timestamp: timestamp,
      voiceProbability: result.voiceProbability,
      isVoice: result.isVoice,
    );
  }

  /// 获取本地媒体流
  MediaStream? get localStream => _localStream;

  /// 获取音频轨道
  MediaStreamTrack? get audioTrack => _audioTrack;

  /// 切换静音
  void toggleMute() {
    if (_audioTrack != null) {
      _audioTrack!.enabled = !_audioTrack!.enabled;
      notifyListeners();
    }
  }

  /// 是否静音
  bool get isMuted => _audioTrack?.enabled == false;

  /// 释放资源
  @override
  void dispose() {
    stopCapture();

    _localStream?.getTracks().forEach((track) => track.stop());
    _localStream?.dispose();

    _noiseProcessor.dispose();
    _audioStreamController.close();

    super.dispose();
  }
}

/// Web 平台音频处理助手
class WebAudioHelper {
  /// 创建 AudioContext
  static dynamic createAudioContext() {
    // Web 平台使用 dart:js_interop
    // return AudioContext();
    return null;
  }

  /// 创建 AudioWorklet (用于低延迟处理)
  static Future<void> setupAudioWorklet(
    dynamic audioContext,
    String workletUrl,
  ) async {
    // await audioContext.audioWorklet.addModule(workletUrl);
  }
}

/// 音频电平检测器
class AudioLevelDetector {
  double _currentLevel = 0.0;
  final List<double> _levelHistory = [];
  static const int _historySize = 10;

  double get currentLevel => _currentLevel;
  double get averageLevel =>
      _levelHistory.isEmpty ? 0.0 :
      _levelHistory.reduce((a, b) => a + b) / _levelHistory.length;

  /// 计算音频电平
  double calculateLevel(Float32List samples) {
    double sum = 0;
    for (final sample in samples) {
      sum += sample * sample;
    }
    final rms = (sum / samples.length);
    _currentLevel = rms.clamp(0.0, 1.0);

    _levelHistory.add(_currentLevel);
    if (_levelHistory.length > _historySize) {
      _levelHistory.removeAt(0);
    }

    return _currentLevel;
  }

  /// 检测是否有人在说话
  bool detectVoiceActivity({double threshold = 0.02}) {
    return _currentLevel > threshold;
  }

  void reset() {
    _currentLevel = 0.0;
    _levelHistory.clear();
  }
}
