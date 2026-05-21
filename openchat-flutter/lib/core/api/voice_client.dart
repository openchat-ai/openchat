import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'ws_signaling_client.dart';
import 'voice_router.dart';
import 'voice_frame.dart';
import '../audio/audio_processor.dart';

enum CallState { idle, calling, ringing, connected, ended }

class VoiceClient {
  final AudioProcessor _audioProcessor;
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  WsSignalingClient? _wsSignaling;
  VoiceRouter? _router;
  StreamSubscription? _wsSub;
  StreamSubscription? _binarySub;
  StreamSubscription? _audioSub;
  String? _currentPeerId;
  bool _isCalling = false;
  int _seq = 0;

  // Unacked frames for retransmission
  final _unacked = <int, _PendingFrame>{};
  Timer? _retryTimer;

  final _callStateCtrl = StreamController<CallState>.broadcast();
  Stream<CallState> get callState => _callStateCtrl.stream;

  VoiceClient(this._audioProcessor);

  Future<void> connect(WsSignalingClient ws, String peerId) async {
    _wsSignaling = ws;
    _router = VoiceRouter(peerId);
    await ws.connect(peerId);
    _wsSub = ws.events.listen(_onSignalingEvent);
    _binarySub = ws.binaryData.listen(_handleBinaryFrame);
    _retryTimer = Timer.periodic(const Duration(milliseconds: 500), _retryUnacked);
  }

  void call(String targetPeerId) {
    _currentPeerId = targetPeerId;
    _isCalling = true;
    _callStateCtrl.add(CallState.calling);
    _sendFrame(FrameType.signal, utf8.encode(jsonEncode({'action': 'call-request', 'toPeerId': targetPeerId})));
  }

  void acceptCall() {
    _callStateCtrl.add(CallState.connected);
    _startAudio();
    _sendFrame(FrameType.signal, utf8.encode(jsonEncode({'action': 'call-accept', 'toPeerId': _currentPeerId})));
  }

  void rejectCall() { _callStateCtrl.add(CallState.idle); }
  void endCall() async {
    _isCalling = false;
    await _audioSub?.cancel();
    await _recorder.stop();
    _retryTimer?.cancel();
    _callStateCtrl.add(CallState.idle);
    _currentPeerId = null;
  }

  void _startAudio() async {
    if (await _recorder.hasPermission() != true) return;
    final stream = await _recorder.startStream(const RecordConfig(
      encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: 24000));
    _audioSub = stream?.listen(_onAudioData, onError: (_) => null);
  }

  void _onAudioData(Uint8List pcm) async {
    if (!_isCalling || _currentPeerId == null || _router == null) return;
    final processed = await _audioProcessor.processMicrophoneInput(pcm);
    if (processed == null) return;

    final seq = _seq++;
    final payload = _router!.buildAudioPacket(_currentPeerId!, base64Encode(processed));
    final frame = VoiceFrame(FrameType.audio, utf8.encode(jsonEncode(payload)));
    _sendBinary(frame.encode());

    // Track for retransmission
    _unacked[seq] = _PendingFrame(data: frame.encode(), sentAt: DateTime.now(), retries: 0);
  }

  void _sendFrame(int type, List<int> payload) {
    _sendBinary(VoiceFrame(type, payload).encode());
  }

  void _sendBinary(List<int> data) {
    _wsSignaling?.channel?.sink.add(data);
  }

  void _onSignalingEvent(SignalingEvent event) {
    // Handle as text frames for backward compat
    if (event.action == 'call-request') {
      _currentPeerId = event.data['fromPeerId'] as String?;
      _callStateCtrl.add(CallState.ringing);
    }
    if (event.action == 'call-accept') {
      _currentPeerId = event.data['fromPeerId'] as String?;
      _callStateCtrl.add(CallState.connected);
      _startAudio();
    }
    if (event.action == 'call-reject' || event.action == 'call-end') endCall();
  }

  void _handleBinaryFrame(List<int> raw) {
    final frame = VoiceFrame.decode(raw);
    if (frame == null) return;

    if (frame.type == FrameType.audio) {
      final data = jsonDecode(utf8.decode(frame.payload));
      if (_router == null) return;
      final result = _router!.handleIncoming(data['data']);
      if (result == null) return;

      // Send ack
      _sendFrame(FrameType.ack, [data['data']['packetId']?.hashCode ?? 0 & 0xFF]);

      final payload = result['payload'] as String?;
      if (payload != null) _processReceived(base64Decode(payload));
    }

    if (frame.type == FrameType.ack && frame.payload.isNotEmpty) {
      _unacked.remove(frame.payload[0]);
    }
  }

  void _retryUnacked(Timer t) {
    final now = DateTime.now();
    _unacked.removeWhere((seq, p) {
      if (p.retries >= 3 || now.difference(p.sentAt).inSeconds > 5) {
        _router?.reportFailure(_currentPeerId ?? '');
        return true; // Give up
      }
      if (now.difference(p.sentAt).inMilliseconds > 1000) {
        _sendBinary(p.data);
        p.retries++;
        p.sentAt = now;
      }
      return false;
    });
  }

  Future<void> _processReceived(Uint8List data) async {
    final decoded = await _audioProcessor.processReceivedAudio(data);
    if (decoded != null) {
      await _player.play(BytesSource(Uint8List.fromList(decoded)));
    }
  }

  void dispose() {
    _wsSub?.cancel();
    _binarySub?.cancel();
    _audioSub?.cancel();
    _retryTimer?.cancel();
    _recorder.dispose();
    _player.dispose();
    _router?.dispose();
    _callStateCtrl.close();
  }
}

class _PendingFrame {
  final List<int> data;
  DateTime sentAt;
  int retries;
  _PendingFrame({required this.data, required this.sentAt, required this.retries});
}
