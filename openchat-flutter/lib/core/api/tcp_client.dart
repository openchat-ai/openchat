/// Raw TCP signaling client — no WebSocket, direct binary frames
import 'dart:async';
import 'dart:convert';
import 'dart:io';

class TcpClient {
  Socket? _socket;
  String? _peerId;
  bool _connected = false;

  final _dataCtrl = StreamController<List<int>>.broadcast();
  Stream<List<int>> get dataStream => _dataCtrl.stream;
  bool get isConnected => _connected;

  Future<void> connect(String host, int port, String peerId) async {
    _peerId = peerId;
    _socket = await Socket.connect(host, port, timeout: const Duration(seconds: 5));
    _connected = true;

    // Send registration frame immediately
    final regFrame = VoiceFrame(0x02, utf8.encode(peerId));
    _socket!.add(regFrame.encode());

    _socket!.listen(
      (data) => _dataCtrl.add(List<int>.from(data)),
      onError: (_) => _connected = false,
      onDone: () => _connected = false,
    );
  }

  void send(List<int> frame) {
    if (_socket != null && _connected) {
      _socket!.add(frame);
    }
  }

  void close() {
    _socket?.close();
    _connected = false;
  }

  void dispose() {
    close();
    _dataCtrl.close();
  }
}
