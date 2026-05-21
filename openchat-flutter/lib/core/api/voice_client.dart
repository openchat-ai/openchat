import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'ws_signaling_client.dart';
import 'voice_router.dart';
import '../audio/audio_processor.dart';

enum CallState { idle, calling, ringing, connected, ended }

class VoiceClient {
  final AudioProcessor _audioProcessor;
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  WsSignalingClient? _wsSignaling;
  VoiceRouter? _router;
  StreamSubscription? _wsSub;
  StreamSubscription? _audioSub;
  String? _currentPeerId;
  bool _isCalling = false;
  final _callStateCtrl = StreamController<CallState>.broadcast();
  Stream<CallState> get callState => _callStateCtrl.stream;

  VoiceClient(this._audioProcessor);

  Future<void> connect(WsSignalingClient ws, String peerId) async {
    _wsSignaling = ws;
    _router = VoiceRouter(peerId);
    await ws.connect(peerId);
    _wsSub = ws.events.listen(_onSignalingEvent);
  }

  void call(String targetPeerId) {
    _currentPeerId = targetPeerId;
    _isCalling = true;
    _callStateCtrl.add(CallState.calling);
    _wsSignaling!.callPeer(targetPeerId, 'route-${DateTime.now().millisecondsSinceEpoch}');
  }

  void acceptCall() {
    _wsSignaling?.acceptCall();
    _callStateCtrl.add(CallState.connected);
    _startAudio();
  }

  void rejectCall() {
    _wsSignaling?.rejectCall();
    _callStateCtrl.add(CallState.idle);
  }

  void endCall() async {
    _isCalling = false;
    await _audioSub?.cancel();
    await _recorder.stop();
    _wsSignaling?.endCall();
    _callStateCtrl.add(CallState.idle);
    _currentPeerId = null;
  }

  void _startAudio() async {
    if (await _recorder.hasPermission() != true) return;
    final stream = await _recorder.startStream(const RecordConfig(
      encoder: AudioEncoder.pcm16bits,
      numChannels: 1,
      sampleRate: 24000,
    ));
    _audioSub = stream?.listen(_onAudioData, onError: (_) => null);
  }

  void _onAudioData(Uint8List pcmData) async {
    if (!_isCalling || _currentPeerId == null || _wsSignaling == null || _router == null) return;
    final processed = await _audioProcessor.processMicrophoneInput(pcmData);
    if (processed == null) return;

    final packet = _router!.buildAudioPacket(_currentPeerId!, base64Encode(processed));
    _wsSignaling!.channel?.sink.add(jsonEncode(packet));
  }

  void _onSignalingEvent(SignalingEvent event) {
    final data = event.data;

    if (event.action == 'call-request') {
      _currentPeerId = data['fromPeerId'] as String?;
      _callStateCtrl.add(CallState.ringing);
    }

    if (event.action == 'call-accept') {
      _currentPeerId = data['fromPeerId'] as String?;
      _callStateCtrl.add(CallState.connected);
      _startAudio();
    }

    if (event.action == 'call-reject' || event.action == 'call-end') {
      endCall();
    }

    if (event.action == 'audio-data') {
      _handleAudioPacket(data);
    }

    // Routing gossip
    if (event.action == 'route-gossip') {
      _router?.mergeGossip(List<Map<String, dynamic>>.from(data['routes']));
    }

    // Route update response
    if (event.action == 'route-update') {
      final target = data['fromPeerId'] as String?;
      if (target != null) {
        _router?.reportSuccess(target, data['latencyMs'] ?? 0);
      }
    }
  }

  void _handleAudioPacket(Map<String, dynamic> data) {
    if (_router == null) return;

    // Try routing: forward if not for us, process if for us
    final result = _router!.handleIncoming(data);
    if (result == null) return; // Already forwarded or dropped

    // This packet is for us
    final payload = result['payload'] as String?;
    if (payload != null) {
      final decoded = base64Decode(payload);
      _processReceived(decoded);
    }
  }

  Future<void> _processReceived(Uint8List data) async {
    final decoded = await _audioProcessor.processReceivedAudio(data);
    if (decoded != null) {
      await _player.play(BytesSource(Uint8List.fromList(decoded)));
    }
  }

  /// Send routing gossip periodically (caller's responsibility to schedule)
  void sendGossip() {
    if (_wsSignaling == null || _router == null) return;
    final routes = _router!.getGossipPayload();
    if (routes.isEmpty) return;
    _wsSignaling!.channel?.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {'action': 'route-gossip', 'routes': routes},
    }));
  }

  void dispose() {
    _wsSub?.cancel();
    _audioSub?.cancel();
    _recorder.dispose();
    _player.dispose();
    _router?.dispose();
    _callStateCtrl.close();
  }
}
