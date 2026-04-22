/// 语音服务
///
/// 高层语音通信服务，集成 RNNoise 降噪
/// 支持 PTT (Push-to-Talk) 和语音激活模式

import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'rnnoise_processor.dart';
import 'audio_pipeline.dart';

// 导出（放在 import 之后）
export 'rnnoise_processor.dart';
export 'audio_pipeline.dart';

/// 语音模式
enum VoiceMode {
  pushToTalk,    // 按住说话
  voiceActivity, // 语音激活
  alwaysOn,      // 始终开启
}

/// 语音状态
enum VoiceState {
  idle,
  connecting,
  connected,
  speaking,
  muted,
  deafen,
  error,
}

/// 语音通话成员
class VoiceMember {
  final String id;
  final String name;
  final String? avatar;
  bool isMuted;
  bool isDeafen;
  bool isSpeaking;
  double volume;

  VoiceMember({
    required this.id,
    required this.name,
    this.avatar,
    this.isMuted = false,
    this.isDeafen = false,
    this.isSpeaking = false,
    this.volume = 1.0,
  });
}

/// 语音房间
class VoiceRoom {
  final String id;
  final String name;
  final List<VoiceMember> members;
  final int maxMembers;

  VoiceRoom({
    required this.id,
    required this.name,
    this.members = const [],
    this.maxMembers = 10,
  });
}

/// 语音服务配置
class VoiceServiceConfig {
  final VoiceMode mode;
  final double voiceActivityThreshold;
  final int vadSilenceDelay;
  final bool enableNoiseSuppression;
  final bool enableEchoCancellation;
  final bool enableAutoGain;

  const VoiceServiceConfig({
    this.mode = VoiceMode.pushToTalk,
    this.voiceActivityThreshold = 0.02,
    this.vadSilenceDelay = 500,
    this.enableNoiseSuppression = true,
    this.enableEchoCancellation = true,
    this.enableAutoGain = true,
  });

  static const VoiceServiceConfig default_ = VoiceServiceConfig();
  static const VoiceServiceConfig gaming = VoiceServiceConfig(
    mode: VoiceMode.pushToTalk,
    vadSilenceDelay: 200,
  );
  static const VoiceServiceConfig meeting = VoiceServiceConfig(
    mode: VoiceMode.voiceActivity,
    voiceActivityThreshold: 0.015,
  );
}

/// 语音服务
class VoiceService extends ChangeNotifier {
  final VoiceServiceConfig config;
  final AudioPipeline _pipeline;
  final AudioLevelDetector _levelDetector;

  VoiceState _state = VoiceState.idle;
  VoiceRoom? _currentRoom;
  RTCPeerConnection? _peerConnection;
  final Map<String, MediaStream> _remoteStreams = {};

  final StreamController<VoiceState> _stateController =
      StreamController<VoiceState>.broadcast();
  final StreamController<VoiceMember> _speakingController =
      StreamController<VoiceMember>.broadcast();

  Stream<VoiceState> get stateStream => _stateController.stream;
  Stream<VoiceMember> get speakingStream => _speakingController.stream;

  VoiceState get state => _state;
  VoiceRoom? get currentRoom => _currentRoom;
  bool get isConnected => _state == VoiceState.connected;
  bool get isSpeaking => _state == VoiceState.speaking;
  bool get isMuted => _state == VoiceState.muted;
  AudioPipeline get pipeline => _pipeline;

  VoiceService({
    this.config = VoiceServiceConfig.default_,
  })  : _pipeline = AudioPipeline(
          config: AudioConfig(
            enableNoiseSuppression: config.enableNoiseSuppression,
            enableEchoCancellation: config.enableEchoCancellation,
            enableAutoGain: config.enableAutoGain,
          ),
        ),
        _levelDetector = AudioLevelDetector();

  /// 初始化服务
  Future<bool> initialize() async {
    if (_state != VoiceState.idle) return true;

    try {
      final ok = await _pipeline.initialize();
      if (!ok) {
        _state = VoiceState.error;
        notifyListeners();
        return false;
      }

      // 设置 WebRTC 连接
      await _setupPeerConnection();

      _state = VoiceState.connected;
      notifyListeners();
      return true;
    } catch (e) {
      debugPrint('语音服务初始化失败: $e');
      _state = VoiceState.error;
      notifyListeners();
      return false;
    }
  }

  /// 设置 WebRTC PeerConnection
  Future<void> _setupPeerConnection() async {
    final configuration = {
      'iceServers': [
        {'urls': 'stun:stun.l.google.com:19302'},
      ]
    };

    _peerConnection = await createPeerConnection(configuration);

    // 添加本地音频轨道
    final localStream = _pipeline.localStream;
    if (localStream != null) {
      for (final track in localStream.getTracks()) {
        await _peerConnection!.addTrack(track, localStream);
      }
    }

    // 处理远程轨道
    _peerConnection!.onTrack = (RTCTrackEvent event) {
      if (event.track.kind == 'audio') {
        _remoteStreams[event.streams.first.id] = event.streams.first;
        _playRemoteAudio(event.streams.first);
      }
    };

    // ICE 候选处理
    _peerConnection!.onIceCandidate = (RTCIceCandidate candidate) {
      // 发送 ICE 候选到信令服务器
      _sendIceCandidate(candidate);
    };
  }

  /// 播放远程音频
  void _playRemoteAudio(MediaStream stream) {
    // Web: 使用 HTML Audio 元素
    // 原生: 使用音频播放器
    debugPrint('播放远程音频: ${stream.id}');
  }

  /// 发送 ICE 候选 (通过信令)
  void _sendIceCandidate(RTCIceCandidate candidate) {
    // TODO: 通过 WebSocket 发送到信令服务器
  }

  /// 加入语音房间
  Future<bool> joinRoom(VoiceRoom room) async {
    if (!await initialize()) return false;

    _currentRoom = room;
    await _pipeline.startCapture();
    notifyListeners();
    return true;
  }

  /// 离开语音房间
  Future<void> leaveRoom() async {
    _pipeline.stopCapture();
    _currentRoom = null;

    // 关闭所有远程流
    for (final stream in _remoteStreams.values) {
      stream.dispose();
    }
    _remoteStreams.clear();

    notifyListeners();
  }

  /// 开始说话 (PTT)
  Future<void> startSpeaking() async {
    if (_state == VoiceState.muted || _state == VoiceState.deafen) return;

    _state = VoiceState.speaking;
    await _pipeline.startCapture();
    _stateController.add(_state);
    notifyListeners();
  }

  /// 停止说话 (PTT)
  void stopSpeaking() {
    if (_state != VoiceState.speaking) return;

    _pipeline.stopCapture();
    _state = VoiceState.connected;
    _stateController.add(_state);
    notifyListeners();
  }

  /// 切换静音
  void toggleMute() {
    if (_state == VoiceState.muted) {
      _state = VoiceState.connected;
      _pipeline.toggleMute();
    } else {
      _state = VoiceState.muted;
      _pipeline.toggleMute();
    }
    notifyListeners();
  }

  /// 设置静音状态
  void setMuted(bool muted) {
    if (muted && _state != VoiceState.muted) {
      _state = VoiceState.muted;
      _pipeline.toggleMute();
    } else if (!muted && _state == VoiceState.muted) {
      _state = VoiceState.connected;
      _pipeline.toggleMute();
    }
    notifyListeners();
  }

  /// 切换耳聋 (听不到别人)
  void toggleDeafen() {
    if (_state == VoiceState.deafen) {
      _state = VoiceState.connected;
      // 恢复所有远程音频
    } else {
      _state = VoiceState.deafen;
      // 静音所有远程音频
    }
    notifyListeners();
  }

  /// 设置音量
  void setVolume(String memberId, double volume) {
    // 设置远程成员音量
  }

  /// 处理语音激活检测
  void _processVoiceActivity(Float32List samples) {
    if (config.mode != VoiceMode.voiceActivity) return;

    final level = _levelDetector.calculateLevel(samples);
    final isVoice = _levelDetector.detectVoiceActivity(
      threshold: config.voiceActivityThreshold,
    );

    if (isVoice && _state == VoiceState.connected) {
      startSpeaking();
    } else if (!isVoice && _state == VoiceState.speaking) {
      // 延迟停止，避免频繁切换
      Future.delayed(Duration(milliseconds: config.vadSilenceDelay), () {
        if (!_levelDetector.detectVoiceActivity(
          threshold: config.voiceActivityThreshold,
        )) {
          stopSpeaking();
        }
      });
    }
  }

  /// 获取音频电平 (用于 UI 显示)
  double get audioLevel => _levelDetector.currentLevel;

  /// 获取平均音频电平
  double get averageAudioLevel => _levelDetector.averageLevel;

  /// 释放资源
  @override
  void dispose() {
    leaveRoom();

    _peerConnection?.close();
    _peerConnection?.dispose();

    _pipeline.dispose();
    _stateController.close();
    _speakingController.close();

    super.dispose();
  }
}

/// PTT 按钮 Widget
class PushToTalkButton extends StatelessWidget {
  final VoiceService voiceService;
  final double size;
  final VoidCallback? onStart;
  final VoidCallback? onStop;

  const PushToTalkButton({
    super.key,
    required this.voiceService,
    this.size = 80,
    this.onStart,
    this.onStop,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTapDown: (_) {
        voiceService.startSpeaking();
        onStart?.call();
      },
      onTapUp: (_) {
        voiceService.stopSpeaking();
        onStop?.call();
      },
      onTapCancel: () {
        voiceService.stopSpeaking();
        onStop?.call();
      },
      child: AnimatedBuilder(
        animation: voiceService,
        builder: (context, child) {
          final isSpeaking = voiceService.isSpeaking;
          final color = isSpeaking ? Colors.green : Colors.grey;

          return Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              color: color.withOpacity(0.2),
              shape: BoxShape.circle,
              border: Border.all(color: color, width: 3),
              boxShadow: isSpeaking
                  ? [
                      BoxShadow(
                        color: color.withOpacity(0.5),
                        blurRadius: 20,
                        spreadRadius: 5,
                      ),
                    ]
                  : null,
            ),
            child: Icon(
              isSpeaking ? Icons.mic : Icons.mic_none,
              color: color,
              size: size * 0.5,
            ),
          );
        },
      ),
    );
  }
}

/// 语音波形可视化
class VoiceWaveform extends StatelessWidget {
  final VoiceService voiceService;
  final double width;
  final double height;

  const VoiceWaveform({
    super.key,
    required this.voiceService,
    this.width = 200,
    this.height = 40,
  });

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: voiceService,
      builder: (context, child) {
        return CustomPaint(
          size: Size(width, height),
          painter: _WaveformPainter(voiceService.audioLevel),
        );
      },
    );
  }
}

class _WaveformPainter extends CustomPainter {
  final double level;

  _WaveformPainter(this.level);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.green
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    final barWidth = 3.0;
    final gap = 2.0;
    final barCount = (size.width / (barWidth + gap)).floor();

    for (int i = 0; i < barCount; i++) {
      final x = i * (barWidth + gap);
      final barHeight = (size.height * level * (0.3 + 0.7 * (i % 3) / 2))
          .clamp(2.0, size.height);

      canvas.drawRect(
        Rect.fromLTWH(
          x,
          (size.height - barHeight) / 2,
          barWidth,
          barHeight,
        ),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _WaveformPainter oldDelegate) {
    return oldDelegate.level != level;
  }
}
