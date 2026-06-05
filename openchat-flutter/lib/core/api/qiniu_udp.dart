import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

/// UDP P2P transport with NAT punching.
/// Uses 0xBB magic header to detect punch responses.
class QiniuUdpTransport {
  String? _publicIp;
  int? _udpPort;
  RawDatagramSocket? _udp;
  bool _punched = false;
  String? _punchedTarget;
  void Function(Uint8List data)? onAudioData;
  Timer? _punchTimer;
  int _punchAttempts = 0;

  String? get publicIp => _publicIp;
  int? get udpPort => _udpPort;
  bool get isReady => _punched && _udp != null;

  /// Discover public IP via ipify/httpbin.
  Future<String> _discoverPublicIp() async {
    final completer = Completer<String>();
    for (final url in [
      'https://api.ipify.org?format=json',
      'https://httpbin.org/ip',
      'https://api.myip.com',
    ]) {
      http.get(Uri.parse(url)).timeout(const Duration(seconds: 3)).then((resp) {
        if (completer.isCompleted) return;
        if (resp.statusCode != 200) return;
        final json = jsonDecode(resp.body);
        final ip = (json['ip'] as String?) ?? (json['origin'] as String?) ?? '';
        if (ip.isNotEmpty) completer.complete(ip);
      }).catchError((_) {});
    }
    Future.delayed(const Duration(seconds: 4), () {
      if (!completer.isCompleted) completer.complete('0.0.0.0');
    });
    return completer.future;
  }

  /// Bind a UDP socket and listen for incoming packets.
  Future<void> setup() async {
    _publicIp = await _discoverPublicIp();
    try {
      _udp = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      _udpPort = _udp!.port;
      _udp!.listen((event) {
        if (event != RawSocketEvent.read) return;
        final dg = _udp!.receive();
        if (dg == null || dg.data.length < 2) return;
        if (dg.data[0] == 0xBB) {
          _punched = true;
          _punchedTarget = '${dg.address.address}:${dg.port}';
          _punchTimer?.cancel();
          if (dg.data.length > 7 && onAudioData != null) onAudioData!(dg.data);
        } else if (onAudioData != null) {
          onAudioData!(dg.data);
        }
      });
    } catch (_) {}
  }

  /// Send NAT punch packets to target.
  void startPunch(String targetIp, int targetPort) {
    _punchAttempts = 0;
    final punch = Uint8List.fromList([0xBB, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7E]);
    _punchTimer = Timer.periodic(const Duration(milliseconds: 200), (_) {
      if (_punched || _punchAttempts > 25) {
        _punchTimer?.cancel();
        return;
      }
      _udp?.send(punch, InternetAddress(targetIp), targetPort);
      _punchAttempts++;
    });
  }

  /// Send arbitrary data over the punched UDP connection.
  void send(List<int> data) {
    if (!isReady) return;
    _udp!.send(
      Uint8List.fromList(data),
      InternetAddress(_punchedTarget!.split(':')[0]),
      int.parse(_punchedTarget!.split(':')[1]),
    );
  }

  void close() {
    _punchTimer?.cancel();
    _udp?.close();
  }
}
