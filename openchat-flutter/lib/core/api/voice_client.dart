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

  // Network quality tracking
  int _rttMs = 100;          // Estimated round-trip time
  int _retriesInWindow = 0;  // Retries in last 10 frames
  int _framesInWindow = 0;
  int _frameSizeMs = 20;     // Current audio frame size (ms), starts at 20ms

  // Adaptive frame sizes
  static const int _frameMs = 20;    // Base recording frame
  static const int _minSendMs = 10;  // Min send interval (bad network)
  static const int _maxSendMs = 60;  // Max send interval (good network)
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
    _audioAccumulator = Uint8List(0);
    stream?.listen(_onAudioData, onError: (_) => null);
  }

  Uint8List _audioAccumulator = Uint8List(0);
  int _lastSendTime = 0;

  void _onAudioData(Uint8List pcm) async {
    if (!_isCalling || _currentPeerId == null) return;

    // Accumulate 20ms base frames
    _audioAccumulator = Uint8List.fromList([..._audioAccumulator, ...pcm]);

    // Compute target frame size based on network quality
    int targetMs;
    if (_rttMs < 100 && _retriesInWindow < 2) {
      targetMs = 60;  // Good: large frame, higher quality
    } else if (_rttMs < 300 && _retriesInWindow < 5) {
      targetMs = 20;  // Fair: normal frame
    } else {
      targetMs = 10;  // Poor: small frame, higher chance
    }

    final targetBytes = targetMs * 480; // 24kHz × 16bit = 480 bytes per 10ms
    if (_audioAccumulator.length < targetBytes) return;

    final frame = Uint8List.fromList(_audioAccumulator.sublist(0, targetBytes));
    _audioAccumulator = Uint8List.fromList(_audioAccumulator.sublist(targetBytes));

    final processed = await _audioProcessor.processMicrophoneInput(frame);
    if (processed == null) return;

    if (_retriesInWindow > 0) _retriesInWindow--;
    final seq = _seq++;
    final encoded = base64Encode(processed);
    final payload = utf8.encode(jsonEncode({'from': _myPeerId, 'to': _currentPeerId, 'data': encoded, 'seq': seq}));
    final frameData = RfFrame(0x00, Cmd.audio, _escape7E(payload)).encode();
    _socket?.add(frameData);
    _unacked[seq] = _PendingFrame(data: frameData, sentAt: DateTime.now(), retries: 0);
  }

  void _onAudioData(Uint8List pcm) async {
    if (!_isCalling || _currentPeerId == null) return;
    final processed = await _audioProcessor.processMicrophoneInput(pcm);
    if (processed == null) return;
    final seq = _seq++;
    final encoded = base64Encode(processed);
    final payload = utf8.encode(jsonEncode({'from': _myPeerId, 'to': _currentPeerId, 'data': encoded, 'seq': seq}));
    final raw = RfFrame(0x00, 0x01, _escape7E(payload)).encode();
    _socket?.add(raw);
    _unacked[seq] = _PendingFrame(data: raw, sentAt: DateTime.now(), retries: 0);
  }

  void _sendFrame(int type, List<int> param) {
    _socket?.add(RfFrame(0x00, type, param).encode());
  }

  void _onData(List<int> raw) {
    if (raw.length == 2 && raw[0] == 0x01 && raw[1] == 0x00) return;

    final unescaped = _unescape7E(raw);
    final frame = RfFrame.decode(unescaped);
    if (frame == null) return;

    if (frame.cmd == 0x03) { // ACK — measure RTT
      if (frame.param.length >= 1) {
        final ackedSeq = frame.param[0];
        final pending = _unacked[ackedSeq];
        if (pending != null) {
          _rttMs = (_rttMs * 3 + DateTime.now().difference(pending.sentAt).inMilliseconds) ~/ 4;
          _retriesInWindow = (_retriesInWindow + pending.retries) ~/ 2;
        }
        _unacked.remove(ackedSeq);
      }
      return;
    }

    if (frame.cmd == 0x01 || frame.cmd == 0x02) { // Audio or Signal
      final json = jsonDecode(utf8.decode(frame.param));
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

  /// Escape 0x7E → 0x7D 0x5E, 0x7D → 0x7D 0x5D
  List<int> _escape7E(List<int> data) {
    final out = <int>[];
    for (final b in data) {
      if (b == 0x7E) { out.addAll([0x7D, 0x5E]); }
      else if (b == 0x7D) { out.addAll([0x7D, 0x5D]); }
      else { out.add(b); }
    }
    return out;
  }

  /// Unescape 0x7D 0x5E → 0x7E, 0x7D 0x5D → 0x7D
  List<int> _unescape7E(List<int> data) {
    final out = <int>[];
    for (int i = 0; i < data.length; i++) {
      if (data[i] == 0x7D && i + 1 < data.length) {
        if (data[i + 1] == 0x5E) { out.add(0x7E); i++; }
        else if (data[i + 1] == 0x5D) { out.add(0x7D); i++; }
        else { out.add(data[i]); }
      } else {
        out.add(data[i]);
      }
    }
    return out;
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
