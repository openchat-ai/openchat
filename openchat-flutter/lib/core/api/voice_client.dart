import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:io';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'voice_router.dart';
import 'voice_frame.dart';
import '../audio/audio_processor.dart';

enum CallState { idle, calling, ringing, connected, ended }

class VoiceClient {
  final AudioProcessor _audioProcessor;
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  final String _host;
  final int _port;
  Socket? _socket;
  bool _connected = false;
  int _seq = 0;
  final _unacked = <int, _PendingFrame>{};
  Timer? _retryTimer;
  String? _myPeerId;
  String? _currentPeerId;
  bool _isCalling = false;
  final _callStateCtrl = StreamController<CallState>.broadcast();
  Stream<CallState> get callState => _callStateCtrl.stream;

  VoiceClient(this._audioProcessor, this._host, this._port);

  Future<void> connect(String peerId) async {
    _myPeerId = peerId;
    _socket = await Socket.connect(_host, _port, timeout: const Duration(seconds: 5));
    _connected = true;

    // Register
    final reg = VoiceFrame(0x02, utf8.encode(peerId)).encode();
    _socket!.add(reg);

    _socket!.listen(_onData, onError: (_) => _connected = false, onDone: () => _connected = false);
    _retryTimer = Timer.periodic(const Duration(milliseconds: 500), _retryUnacked);
  }

  void call(String targetPeerId) {
    _currentPeerId = targetPeerId;
    _isCalling = true;
    _callStateCtrl.add(CallState.calling);
    _sendFrame(0x02, utf8.encode(jsonEncode({'action': 'call-request', 'toPeerId': targetPeerId})));
  }

  void acceptCall() {
    _callStateCtrl.add(CallState.connected);
    _startAudio();
  }

  void endCall() async {
    _isCalling = false;
    await _recorder.stop();
    _retryTimer?.cancel();
    _socket?.close();
    _callStateCtrl.add(CallState.idle);
    _currentPeerId = null;
  }

  void _startAudio() async {
    if (await _recorder.hasPermission() != true) return;
    final stream = await _recorder.startStream(const RecordConfig(
      encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: 24000));
    stream?.listen(_onAudioData, onError: (_) => null);
  }

  void _onAudioData(Uint8List pcm) async {
    if (!_isCalling || _currentPeerId == null) return;
    final processed = await _audioProcessor.processMicrophoneInput(pcm);
    if (processed == null) return;
    final seq = _seq++;
    final encoded = base64Encode(processed);
    final payload = utf8.encode(jsonEncode({'from': _myPeerId, 'to': _currentPeerId, 'data': encoded, 'seq': seq}));
    final frame = VoiceFrame(0x01, payload);
    final raw = frame.encode();
    _socket?.add(raw);
    _unacked[seq] = _PendingFrame(data: raw, sentAt: DateTime.now(), retries: 0);
  }

  void _sendFrame(int type, List<int> payload) {
    _socket?.add(VoiceFrame(type, payload).encode());
  }

  void _onData(List<int> raw) {
    // Handle registration confirmation
    if (raw.length == 2 && raw[0] == 0x01 && raw[1] == 0x00) return;

    final frame = VoiceFrame.decode(raw);
    if (frame == null) return;

    if (frame.type == 0x03) { // ACK
      if (frame.payload.isNotEmpty) _unacked.remove(frame.payload[0]);
      return;
    }

    if (frame.type == 0x01 || frame.type == 0x02) { // Audio or Signal
      final json = jsonDecode(utf8.decode(frame.payload));
      final type = json['action'] ?? 'audio';

      if (type == 'call-request') {
        _currentPeerId = json['fromPeerId'] as String?;
        _callStateCtrl.add(CallState.ringing);
        return;
      }
      if (type == 'call-accept') {
        _callStateCtrl.add(CallState.connected);
        _startAudio();
        return;
      }

      if (type == 'audio') {
        final encoded = json['data'] as String?;
        if (encoded != null) _processReceived(base64Decode(encoded));
        // Send ACK
        final seq = json['seq'] as int?;
        if (seq != null) _sendFrame(0x03, [seq & 0xFF]);
      }
    }
  }

  void _retryUnacked(Timer t) {
    final now = DateTime.now();
    _unacked.removeWhere((seq, p) {
      if (p.retries >= 3 || now.difference(p.sentAt).inSeconds > 5) return true;
      if (now.difference(p.sentAt).inMilliseconds > 1000) {
        _socket?.add(p.data);
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
    _retryTimer?.cancel();
    _socket?.close();
    _recorder.dispose();
    _player.dispose();
    _callStateCtrl.close();
  }
}

class _PendingFrame {
  final List<int> data;
  DateTime sentAt;
  int retries;
  _PendingFrame({required this.data, required this.sentAt, required this.retries});
}
