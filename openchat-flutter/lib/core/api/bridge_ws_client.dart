import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

class BridgeWsMessage {
  final String type;
  final Map<String, dynamic> data;
  final String? sessionId;
  BridgeWsMessage({required this.type, required this.data, this.sessionId});
  factory BridgeWsMessage.fromJson(Map<String, dynamic> json) => BridgeWsMessage(
    type: json['type'] as String? ?? '',
    data: json['data'] as Map<String, dynamic>? ?? {},
    sessionId: json['sessionId'] as String?,
  );
}

class BridgeWsClient {
  WebSocketChannel? _channel;
  String _host;
  int _port;
  String? _token;
  bool _connected = false;
  bool _reconnect = true;
  Timer? _reconnectTimer;
  final _messageController = StreamController<BridgeWsMessage>.broadcast();
  final _statusController = StreamController<bool>.broadcast();

  Stream<BridgeWsMessage> get messages => _messageController.stream;
  Stream<bool> get connectionStatus => _statusController.stream;
  bool get isConnected => _connected;

  BridgeWsClient({String host = 'localhost', int port = 3800, String? token})
      : _host = host, _port = port, _token = token;

  void configure({String? host, int? port, String? token}) {
    _host = host ?? _host;
    _port = port ?? _port;
    _token = token ?? _token;
  }

  Future<void> connect() async {
    _reconnect = true;
    _reconnectTimer?.cancel();
    await _doConnect();
  }

  Future<void> _doConnect() async {
    try {
      final uri = Uri.parse('ws://$_host:$_port/ws');
      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;
      _connected = true;
      _statusController.add(true);
      _channel!.stream.listen(_onMessage, onError: _onError, onDone: _onDone);
    } catch (e) {
      _connected = false;
      _statusController.add(false);
      _scheduleReconnect();
    }
  }

  void _onMessage(dynamic data) {
    try {
      final json = jsonDecode(data as String) as Map<String, dynamic>;
      final msg = BridgeWsMessage.fromJson(json);
      if (msg.type == 'bridge_handshake') return;
      _messageController.add(msg);
    } catch (_) {}
  }

  void _onError(Object error) {
    _connected = false;
    _statusController.add(false);
    _scheduleReconnect();
  }

  void _onDone() {
    _connected = false;
    _statusController.add(false);
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (!_reconnect) return;
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(const Duration(seconds: 3), _doConnect);
  }

  void sendMessage(String text, {String? sessionId}) {
    if (_channel == null || !_connected) return;
    _channel!.sink.add(jsonEncode({
      'type': 'chat',
      'data': {'message': text, 'sessionId': sessionId},
      'sessionId': sessionId,
    }));
  }

  void disconnect() {
    _reconnect = false;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _connected = false;
    _statusController.add(false);
  }

  void dispose() {
    disconnect();
    _messageController.close();
    _statusController.close();
  }
}
