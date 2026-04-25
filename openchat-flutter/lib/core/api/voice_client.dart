import 'dart:async';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'base_client.dart';

/// 语音房间信息
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

/// 参与者信息
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

/// 语音客户端 - AI Agent 实时语音通信
class VoiceClient extends BaseClient {
  RTCPeerConnection? _peerConnection;
  RTCDataChannel? _dataChannel;
  MediaStream? _localStream;

  final _audioTracksController = StreamController<Map<String, bool>>.broadcast();
  final _transcriptsController = StreamController<String>.broadcast();
  final _speakingController = StreamController<bool>.broadcast();

  String? _currentRoomId;
  String? _participantId;
  List<Participant> _participants = [];

  VoiceClient(super.baseUrl);

  /// 获取音频轨道流
  Stream<Map<String, bool>> get audioTracks => _audioTracksController.stream;

  /// 获取文字转录流
  Stream<String> get transcripts => _transcriptsController.stream;

  /// 获取说话状态流
  Stream<bool> get speakingEvents => _speakingController.stream;

  /// 获取参与者列表
  List<Participant> get participants => _participants;

  /// 创建语音房间
  Future<VoiceRoom> createRoom({String? name, int maxParticipants = 10}) async {
    final response = await post(
      '/api/v1/voice/rooms',
      body: {
        'name': name ?? 'AI Discussion',
        'maxParticipants': maxParticipants,
        'mode': 'conference',
      },
    );
    return VoiceRoom.fromJson(response.data);
  }

  /// 获取房间列表
  Future<List<VoiceRoom>> listRooms() async {
    final response = await get('/api/v1/voice/rooms');
    return (response.data['rooms'] as List)
        .map((e) => VoiceRoom.fromJson(e))
        .toList();
  }

  /// 加入房间
  Future<void> joinRoom(String roomId, {
    required String agentId,
    required String agentType,
    bool sttEnabled = true,
    bool ttsEnabled = true,
  }) async {
    _currentRoomId = roomId;

    // 获取 ICE 服务器配置
    final iceResponse = await post(
      '/api/v1/voice/rooms/$roomId/join',
      body: {
        'agentId': agentId,
        'agentType': agentType,
        'sttEnabled': sttEnabled,
        'ttsEnabled': ttsEnabled,
      },
    );

    final data = iceResponse.data;
    _participantId = data['participant']['id'];

    // 初始化 WebRTC
    await _initWebRTC(data['iceServers']);

    // 获取本地音频
    _localStream = await navigator.mediaDevices({'audio': true});
    _localStream!.audioTracks.forEach((track) {
      _peerConnection!.addTrack(track, _localStream!);
    });

    // 创建数据通道
    _dataChannel = await _peerConnection!.createDataChannel('voice');

    // 设置 ICE 候选人
    _peerConnection!.onIceCandidate = (candidate) {
      _sendSignal({
        'type': 'ice-candidate',
        'data': candidate.toMap(),
      });
    };

    // 监听远程轨道
    _peerConnection!.onTrack = (event) {
      if (event.track.kind == 'audio') {
        // 播放远程音频
        event.streams[0].getAudioTracks().forEach((track) {
          // 播放音频
        });
      }
    };

    // 创建 Offer
    final offer = await _peerConnection!.createOffer();
    await _peerConnection!.setLocalDescription(offer);

    // 发送 Offer 到服务器
    await _sendSignal({
      'type': 'offer',
      'data': offer.toMap(),
    });
  }

  /// 初始化 WebRTC
  Future<void> _initWebRTC(List<dynamic> iceServers) async {
    final config = {
      'iceServers': iceServers.map((s) => {
        'urls': s['urls'],
        if (s.containsKey('credential')) 'credential': s['credential'],
      }).toList(),
    };

    _peerConnection = await createPeerConnection(config);

    // 监听连接状态
    _peerConnection!.onConnectionState = (state) {
      if (state == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
        _speakingController.add(true);
      } else if (state == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
        _speakingController.add(false);
      }
    };

    // 监听数据通道
    _peerConnection!.ondatachannel = (channel) {
      _setupDataChannel(channel);
    };
  }

  /// 设置数据通道
  void _setupDataChannel(RTCDataChannel channel) {
    channel.onMessage = (message) {
      final data = message.data;
      if (data['type'] == 'transcript') {
        _transcriptsController.add(data['text']);
      } else if (data['type'] == 'speaking') {
        _audioTracksController.add(data['participants']);
      }
    };
  }

  /// 发送信令消息
  Future<void> _sendSignal(Map<String, dynamic> signal) async {
    if (_currentRoomId == null || _participantId == null) return;

    await post(
      '/api/v1/voice/rooms/$_currentRoomId/signal',
      body: {
        'participantId': _participantId,
        'signal': signal,
      },
    );
  }

  /// 离开房间
  Future<void> leaveRoom() async {
    if (_participantId != null && _currentRoomId != null) {
      await post('/api/v1/voice/rooms/$_currentRoomId/leave', body: {
        'participantId': _participantId,
      });
    }

    await _cleanup();
  }

  /// 清理资源
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

  /// 发送文字转语音请求
  Future<void> sendTextToSpeech(String text) async {
    if (_dataChannel == null) return;

    await _dataChannel!.send(RTCDataChannelMessage('{"type":"tts","text":"$text"}'));
  }

  /// 切换到文字模式
  Future<void> toggleTextMode(bool enabled) async {
    if (_participantId == null || _currentRoomId == null) return;

    await post(
      '/api/v1/voice/rooms/$_currentRoomId/mode',
      body: {
        'participantId': _participantId,
        'mode': enabled ? 'text' : 'voice',
      },
    );
  }

  /// 获取房间信息
  Future<VoiceRoom> getRoom(String roomId) async {
    final response = await get('/api/v1/voice/rooms/$roomId');
    return VoiceRoom.fromJson(response.data);
  }

  /// 释放资源
  void dispose() {
    _cleanup();
    _audioTracksController.close();
    _transcriptsController.close();
    _speakingController.close();
  }
}