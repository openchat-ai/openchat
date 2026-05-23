import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
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
  UdpHolePunch? _udp;
  bool _useUdp = false;
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
    for (int attempt = 0; attempt < 3; attempt++) {
      try {
        _socket = await Socket.connect(_host, _port, timeout: const Duration(seconds: 5));
        break;
      } catch (_) {
        if (attempt < 2) await Future.delayed(Duration(seconds: 1 << attempt));
        else rethrow;
      }
    }
    _connected = true;

    final reg = RfFrame(0x00, 0x02, utf8.encode(peerId)).encode();
    _socket!.add(reg);

    _socket!.listen(_onTcpData, onError: (_) => _reconnect(), onDone: () => _reconnect());
    _retryTimer = Timer.periodic(const Duration(milliseconds: 500), _retryUnacked);
  }

  Future<void> _reconnect() async {
    _connected = false;
    _socket?.close();
    if (_myPeerId != null) {
      try {
        await connect(_myPeerId!);
      } catch (_) {}
    }
  }

  void call(String targetPeerId) async {
    _currentPeerId = targetPeerId;
    _isCalling = true;
    _callStateCtrl.add(CallState.calling);
    _sendFrame(0x02, utf8.encode(jsonEncode({'action': 'call-request', 'toPeerId': targetPeerId})));

    // Try UDP hole punch in parallel
    _udp = UdpHolePunch(_host, _port, _myPeerId!);
    _udp?.onAudio(_onUdpData);
    final punched = await _udp!.punch(targetPeerId);
    _useUdp = punched;
  }

  void _onUdpData(List<int> data) {
    final frame = RfFrame.decode(data);
    if (frame == null || frame.param.length == 0) return;
    final payload = base64Decode(utf8.decode(frame.param));
    _processReceived(payload);
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
    _udp?.close();
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
    if (_useUdp && _udp != null) {
      _udp!.send(frameData);  // Send via UDP
    } else {
      _socket?.add(frameData);  // Fall back to TCP
    }
    _unacked[seq] = _PendingFrame(data: frameData, sentAt: DateTime.now(), retries: 0);
  }

  void _sendFrame(int type, List<int> param) {
    _socket?.add(RfFrame(0x00, type, param).encode());
  }

  void _onTcpData(List<int> raw) {
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
}

// ========== UDP Hole Punching ==========

class UdpHolePunch {
  RawDatagramSocket? _socket;
  final String _bridgeHost;
  final int _bridgePort;
  final String _myPeerId;
  String? _targetIp;
  int? _targetPort;
  bool _punched = false;

  UdpHolePunch(this._bridgeHost, this._bridgePort, this._myPeerId);

  /// Register UDP endpoint with Bridge, get target's address, punch hole
  Future<bool> punch(String targetPeerId) async {
    try {
      _socket = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      final myPort = _socket!.port;

      // Register with Bridge
      final client = HttpClient();
      final punchReq = await client.postUrl(Uri.parse('http://$_bridgeHost:$_bridgePort/api/v1/signaling/udp-punch'));
      punchReq.headers.contentType = ContentType.json;
      punchReq.write(jsonEncode({'myPeerId': _myPeerId, 'targetPeerId': targetPeerId, 'myPort': myPort}));
      final resp = await punchReq.close();
      final body = jsonDecode(await resp.transform(utf8.decoder).join());

      if (body['success'] != true) return false;

      _targetIp = body['targetIp'] as String?;
      _targetPort = body['targetPort'] as int?;
      if (_targetIp == null || _targetPort == null) return false;

      // Send punch packet to target
      final punchPacket = Uint8List.fromList([0xBB, 0x00, 0x06, 0x00, 0x00, 0x06, 0x7E]); // Ping
      _socket!.send(punchPacket, InternetAddress(_targetIp!), _targetPort!);

      // Listen for their punch packet (Dart 3.x: RawSocketEvent → receive Datagram)
      _socket!.listen((event) {
        if (event == RawSocketEvent.read) {
          final datagram = _socket!.receive();
          if (datagram != null && datagram.data.length >= 2 && datagram.data[0] == 0xBB) {
            _punched = true;
            _onPunched?.call(datagram.data);
          }
        }
      });

      // Wait briefly for reply
      await Future.delayed(const Duration(milliseconds: 500));
      return _punched;
    } catch (_) {
      return false;
    }
  }

  void Function(List<int>)? _onPunched;
  void onAudio(void Function(List<int>) cb) { _onPunched = cb; }

  void send(List<int> data) {
    if (_socket != null && _targetIp != null && _targetPort != null) {
      _socket!.send(Uint8List.fromList(data), InternetAddress(_targetIp!), _targetPort!);
    }
  }

  void close() { _socket?.close(); }
}

class _PendingFrame {
  final List<int> data;
  DateTime sentAt;
  int retries;
  _PendingFrame({required this.data, required this.sentAt, required this.retries});
}
