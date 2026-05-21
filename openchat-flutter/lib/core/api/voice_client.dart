import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'ws_signaling_client.dart';
import '../audio/audio_processor.dart';

enum CallState { idle, calling, ringing, connected, ended }

class VoiceRoom {
  final String id;
  final String name;
  final int participantCount;
  final String status;
  final DateTime createdAt;

  VoiceRoom({required this.id, required this.name, required this.participantCount, required this.status, required this.createdAt});
  factory VoiceRoom.fromJson(Map<String, dynamic> json) => VoiceRoom(id: json['id'], name: json['name'], participantCount: json['participantCount'] ?? 0, status: json['status'] ?? 'active', createdAt: DateTime.parse(json['createdAt']));
}

class VoiceClient {
  final AudioProcessor _audioProcessor;
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  WsSignalingClient? _wsSignaling;
  StreamSubscription? _wsSub;
  StreamSubscription? _recorderSub;
  String? _currentPeerId;
  String? _currentRoomId;
  bool _isCalling = false;

  final _callStateCtrl = StreamController<CallState>.broadcast();
  Stream<CallState> get callState => _callStateCtrl.stream;

  VoiceClient(this._audioProcessor);

  Future<void> connect(WsSignalingClient ws, String peerId) async {
    _wsSignaling = ws;
    await ws.connect(peerId);
    _wsSub = ws.events.listen(_onSignalingEvent);
  }

  void call(String targetPeerId, String roomId) {
    if (_wsSignaling == null) return;
    _currentPeerId = targetPeerId;
    _currentRoomId = roomId;
    _isCalling = true;
    _callStateCtrl.add(CallState.calling);
    _wsSignaling!.callPeer(targetPeerId, roomId);
  }

  void acceptCall() {
    _wsSignaling?.acceptCall();
    _callStateCtrl.add(CallState.connected);
    _startAudioStream();
  }

  void rejectCall() {
    _wsSignaling?.rejectCall();
    _callStateCtrl.add(CallState.idle);
  }

  void endCall() async {
    _isCalling = false;
    await _recorderSub?.cancel();
    await _recorder.stop();
    _wsSignaling?.endCall();
    _callStateCtrl.add(CallState.idle);
    _currentPeerId = null;
    _currentRoomId = null;
  }

  void _startAudioStream() async {
    if (await _recorder.hasPermission() != true) return;

    final stream = await _recorder.startStream(const RecordConfig(
      encoder: AudioEncoder.pcm16bits,
      numChannels: 1,
      sampleRate: 24000,
    ));

    _recorderSub = stream?.listen((data) {
      if (!_isCalling || _currentPeerId == null) return;
      _sendAudio(data);
    }, onError: (e) => null);
  }

  void _sendAudio(Uint8List pcmData) async {
    final processed = await _audioProcessor.processMicrophoneInput(pcmData);
    if (processed == null || _wsSignaling == null) return;
    _wsSignaling!.channel?.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {
        'action': 'audio-data',
        'toPeerId': _currentPeerId,
        'roomId': _currentRoomId,
        'payload': base64Encode(processed),
      },
    }));
  }

  void _onSignalingEvent(SignalingEvent event) {
    if (event.action == 'call-request') {
      _currentPeerId = event.data['fromPeerId'] as String?;
      _currentRoomId = event.data['roomId'] as String?;
      _callStateCtrl.add(CallState.ringing);
    }

    if (event.action == 'call-accept') {
      _currentPeerId = event.data['fromPeerId'] as String?;
      _currentRoomId = event.data['roomId'] as String?;
      _callStateCtrl.add(CallState.connected);
      _startAudioStream();
    }

    if (event.action == 'call-reject' || event.action == 'call-end') {
      endCall();
    }

    if (event.action == 'audio-data') {
      final payload = event.data['payload'] as String?;
      if (payload != null) {
        final decoded = base64Decode(payload);
        _handleAudio(decoded);
      }
    }
  }

  Future<void> _handleAudio(Uint8List data) async {
    final decoded = await _audioProcessor.processReceivedAudio(data);
    if (decoded != null) {
      await _player.play(BytesSource(Uint8List.fromList(decoded)));
    }
  }

  void dispose() {
    _wsSub?.cancel();
    _recorderSub?.cancel();
    _recorder.dispose();
    _player.dispose();
    _callStateCtrl.close();
  }
}
