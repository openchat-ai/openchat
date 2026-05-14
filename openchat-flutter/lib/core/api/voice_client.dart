import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'base_client.dart';
import '../audio/audio_processor.dart';

class VoiceRoom {
  final String id;
  final String name;
  final int participantCount;
  final String status;
  final DateTime createdAt;

  VoiceRoom({
    required this.id,
    required this.name,
    required this.participantCount,
    required this.status,
    required this.createdAt,
  });

  factory VoiceRoom.fromJson(Map<String, dynamic> json) {
    return VoiceRoom(
      id: json['id'],
      name: json['name'],
      participantCount: json['participantCount'] ?? 0,
      status: json['status'] ?? 'active',
      createdAt: DateTime.parse(json['createdAt']),
    );
  }
}

class Participant {
  final String id;
  final String agentId;
  final String agentType;
  final String role;
  final bool speaking;
  final bool sttEnabled;
  final bool ttsEnabled;

  Participant({
    required this.id,
    required this.agentId,
    required this.agentType,
    required this.role,
    required this.speaking,
    required this.sttEnabled,
    required this.ttsEnabled,
  });

  factory Participant.fromJson(Map<String, dynamic> json) {
    return Participant(
      id: json['id'],
      agentId: json['agentId'],
      agentType: json['agentType'],
      role: json['role'] ?? 'participant',
      speaking: json['speaking'] ?? false,
      sttEnabled: json['sttEnabled'] ?? true,
      ttsEnabled: json['ttsEnabled'] ?? true,
    );
  }
}

class VoiceClient extends BaseClient {
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  MediaStream? _localStream;
  AudioProcessor? _audioProcessor;

  final _audioTracksController = StreamController<Map<String, bool>>.broadcast();
  final _transcriptsController = StreamController<String>.broadcast();
  final _speakingController = StreamController<bool>.broadcast();
  final _audioLevelController = StreamController<double>.broadcast();

  String? _currentRoomId;
  String? _participantId;
  List<Participant> _participants = [];

  VoiceClient({required super.baseUrl, super.token});

  Stream<Map<String, bool>> get audioTracks => _audioTracksController.stream;
  Stream<String> get transcripts => _transcriptsController.stream;
  Stream<bool> get speakingEvents => _speakingController.stream;
  Stream<double> get audioLevel => _audioLevelController.stream;
  List<Participant> get participants => _participants;

  /// 初始化音频处理器
  Future<void> initializeAudio({
    bool enableDenoise = true,
    bool enableCodec = true,
    int sampleRate = 24000,
  }) async {
    _audioProcessor = AudioProcessor(
      sampleRate: sampleRate,
      enableDenoise: enableDenoise,
      enableCodec: enableCodec,
    );
    await _audioProcessor!.initialize();

    // 监听音频事件
    _audioProcessor!.speakingEvents.listen((speaking) {
      _speakingController.add(speaking);
    });

    _audioProcessor!.audioLevel.listen((level) {
      _audioLevelController.add(level);
    });
  }

  /// 设置音频模式
  void setAudioMode(AudioMode mode) {
    _audioProcessor?.setMode(mode);
  }

  /// 获取音频统计
  Map<String, dynamic>? getAudioStats() {
    return _audioProcessor?.getStats();
  }

  Future<VoiceRoom> createRoom({String? name, int maxParticipants = 10, String mode = 'conference'}) async {
    final response = await dio.post(
      '$baseUrl/api/v1/voice/rooms',
      data: {
        'name': name ?? 'AI Discussion',
        'maxParticipants': maxParticipants,
        'mode': mode,
      },
    );
    return VoiceRoom.fromJson(response.data);
  }

  Future<List<VoiceRoom>> listRooms() async {
    final response = await dio.get('$baseUrl/api/v1/voice/rooms');
    return (response.data['rooms'] as List)
        .map((e) => VoiceRoom.fromJson(e))
        .toList();
  }

  Future<void> joinRoom(String roomId, {
    required String agentId,
    required String agentType,
    bool sttEnabled = true,
    bool ttsEnabled = true,
  }) async {
    _currentRoomId = roomId;

    final iceResponse = await dio.post(
      '$baseUrl/api/v1/voice/rooms/$roomId/join',
      data: {
        'agentId': agentId,
        'agentType': agentType,
        'sttEnabled': sttEnabled,
        'ttsEnabled': ttsEnabled,
      },
    );

    final data = iceResponse.data;
    _participantId = data['participant']['id'];

    await _initWebRTC(data['iceServers']);

    _localStream = await navigator.mediaDevices.getUserMedia({'audio': true});

    // 设置音频处理器进行降噪和编码
    if (_audioProcessor != null) {
      // 处理本地音频轨道
      for (final track in _localStream!.getAudioTracks()) {
        // 可以在这里添加音频处理器
        _peerConnection!.addTrack(track, _localStream!);
      }
    } else {
      for (final track in _localStream!.getAudioTracks()) {
        _peerConnection!.addTrack(track, _localStream!);
      }
    }

    _dataChannel = await _peerConnection!.createDataChannel('voice', RTCDataChannelInit()..ordered = true);

    _peerConnection!.onIceCandidate = (candidate) {
      _sendSignal({
        'type': 'ice-candidate',
        'data': candidate.toMap(),
      });
    };

    _peerConnection!.onTrack = (event) async {
      if (event.track.kind == 'audio') {
        // 接收到的音频�?WebRTC 自动播放
        // 如需处理（解码），可以通过 DataChannel 接收
      }
    };

    // 处理 DataChannel 消息（接收音频数据）
    _peerConnection!.onDataChannel = (channel) {
      _setupDataChannel(channel);
    };

    final offer = await _peerConnection!.createOffer();
    await _peerConnection!.setLocalDescription(offer);

    await _sendSignal({
      'type': 'offer',
      'data': offer.toMap(),
    });
  }

  /// 发送处理后的音�?(通过 Neural Codec 编码)
  Future<void> sendProcessedAudio(Uint8List pcmData) async {
    if (_audioProcessor == null || _dataChannel == null) return;

    final processed = await _audioProcessor!.processMicrophoneInput(pcmData);
    if (processed != null && _dataChannel!.state == RTCDataChannelState.RTCDataChannelOpen) {
      final message = {
        'type': 'audio',
        'data': base64Encode(processed),
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      };
      await _dataChannel!.send(RTCDataChannelMessage(jsonEncode(message)));
    }
  }

  /// 处理接收到的音频数据 (通过 Neural Codec 解码)
  Future<void> _handleReceivedAudioData(String base64Data) async {
    if (_audioProcessor == null) return;

    try {
      final encodedData = base64Decode(base64Data);
      final decoded = await _audioProcessor!.processReceivedAudio(Uint8List.fromList(encodedData));
      // 解码后的音频可以播放或进一步处�?      if (decoded != null) {
        // 可以通过 WebRTC �?AudioPlayer 播放
      }
    } catch (e) {
      // 解码失败，忽�?    }
  }

  Future<void> _initWebRTC(List<dynamic> iceServers) async {
    final config = {
      'iceServers': iceServers.map((s) => {
        'urls': s['urls'],
        if (s.containsKey('credential')) 'credential': s['credential'],
      }).toList(),
    };

    _peerConnection = await createPeerConnection(config as Map<String, dynamic>);

    _peerConnection!.onConnectionState = (state) {
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        _speakingController.add(true);
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        _speakingController.add(false);
      }
    };

    _peerConnection!.onDataChannel = (channel) {
      _setupDataChannel(channel);
    };
  }

  void _setupDataChannel(RTCDataChannel channel) {
    _dataChannel = channel;

    channel.onMessage = (message) {
      try {
        final data = jsonDecode(message.text) as Map<String, dynamic>;
        if (data['type'] == 'transcript') {
          _transcriptsController.add(data['text'] as String);
        } else if (data['type'] == 'speaking') {
          _audioTracksController.add(Map<String, bool>.from(data['participants'] as Map));
        } else if (data['type'] == 'audio') {
          // 处理接收到的音频数据
          _handleReceivedAudioData(data['data'] as String);
        }
      } catch (_) {}
    };
  }

  Future<void> _sendSignal(Map<String, dynamic> signal) async {
    if (_currentRoomId == null || _participantId == null) return;

    await dio.post(
      '$baseUrl/api/v1/voice/rooms/$_currentRoomId/signal',
      data: {
        'participantId': _participantId,
        'signal': signal,
      },
    );
  }

  Future<void> leaveRoom() async {
    if (_participantId != null && _currentRoomId != null) {
      await dio.post('$baseUrl/api/v1/voice/rooms/$_currentRoomId/leave', data: {
        'participantId': _participantId,
      });
    }

    await _cleanup();
  }

  Future<void> _cleanup() async {
    _localStream?.dispose();
    await _dataChannel?.close();
    await _peerConnection?.close();

    _localStream = null;
    _dataChannel = null;
    _peerConnection = null;
    _currentRoomId = null;
    _participantId = null;
    _participants = [];
  }

  Future<void> sendTextToSpeech(String text) async {
    if (_dataChannel == null) return;
    final msg = jsonEncode({'type': 'tts', 'text': text});
    await _dataChannel!.send(RTCDataChannelMessage(msg));
  }

  Future<void> toggleTextMode(bool enabled) async {
    if (_participantId == null || _currentRoomId == null) return;

    await dio.post(
      '$baseUrl/api/v1/voice/rooms/$_currentRoomId/mode',
      data: {
        'participantId': _participantId,
        'mode': enabled ? 'text' : 'voice',
      },
    );
  }

  Future<VoiceRoom> getRoom(String roomId) async {
    final response = await dio.get('$baseUrl/api/v1/voice/rooms/$roomId');
    return VoiceRoom.fromJson(response.data);
  }

  void dispose() {
    _cleanup();
    _audioProcessor?.dispose();
    _audioTracksController.close();
    _transcriptsController.close();
    _speakingController.close();
    _audioLevelController.close();
  }
}
