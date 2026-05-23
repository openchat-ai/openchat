import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

enum WsConnectionState { disconnected, connecting, connected, reconnecting }

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

class WsConnectionInfo {
  final WsConnectionState state;
  final int reconnectAttempt;
  final int? nextRetrySeconds;
  WsConnectionInfo({
    required this.state,
    this.reconnectAttempt = 0,
    this.nextRetrySeconds,
  });
}

class BridgeWsClient {
  WebSocketChannel? _channel;
  String _host;
  int _port;
  String? _token;
  WsConnectionState _state = WsConnectionState.disconnected;
  bool _reconnect = true;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  int _reconnectAttempt = 0;
  static const int _maxReconnectAttempts = 10;
  static const int _maxReconnectDelay = 30;
  static const int _heartbeatInterval = 25;
  String? _peerId;
  final _messageController = StreamController<BridgeWsMessage>.broadcast();
  final _stateController = StreamController<WsConnectionInfo>.broadcast();

  Stream<BridgeWsMessage> get messages => _messageController.stream;
  Stream<WsConnectionInfo> get connectionState => _stateController.stream;
  bool get isConnected => _state == WsConnectionState.connected;
  WsConnectionState get state => _state;
  String? get peerId => _peerId;

  BridgeWsClient({String host = 'localhost', int port = 3800, String? token})
      : _host = host, _port = port, _token = token;

  void configure({String? host, int? port, String? token}) {
    _host = host ?? _host;
    _port = port ?? _port;
    _token = token ?? _token;
  }

  Future<void> connect() async {
    _reconnect = true;
    _reconnectAttempt = 0;
    _reconnectTimer?.cancel();
    await _doConnect();
  }

  Future<void> _doConnect() async {
    _setState(WsConnectionState.connecting);
    try {
      var uriStr = 'ws://$_host:$_port/ws';
      if (_token != null && _token!.isNotEmpty) uriStr += '?token=$_token';
      final uri = Uri.parse(uriStr);
      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;
      _reconnectAttempt = 0;
      _setState(WsConnectionState.connected);
      _startHeartbeat();
      _channel!.stream.listen(_onMessage, onError: _onError, onDone: _onDone);
    } catch (e) {
      _state = WsConnectionState.disconnected;
      _setState(WsConnectionState.disconnected);
      _scheduleReconnect();
    }
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(
      Duration(seconds: _heartbeatInterval),
      (_) {
        if (_channel != null && _state == WsConnectionState.connected) {
          try {
            _channel!.sink.add(jsonEncode({'type': 'ping'}));
          } catch (_) {
            _onError('heartbeat failed');
          }
        }
      },
    );
  }

  void _setState(WsConnectionState newState) {
    _state = newState;
    _stateController.add(WsConnectionInfo(
      state: newState,
      reconnectAttempt: _reconnectAttempt,
      nextRetrySeconds: _reconnectTimer != null && newState == WsConnectionState.reconnecting
          ? (_reconnectAttempt * 2).clamp(1, _maxReconnectDelay)
          : null,
    ));
  }

  void _onMessage(dynamic data) {
    try {
      final text = data as String;
      if (text == 'pong') return;
      final json = jsonDecode(text) as Map<String, dynamic>;
      final msg = BridgeWsMessage.fromJson(json);
      if (msg.type == 'bridge_handshake') {
        _peerId = msg.data['peerId'] as String?;
        return;
      }
      _messageController.add(msg);
    } catch (_) {}
  }

  void _onError(Object error) {
    _heartbeatTimer?.cancel();
    _setState(WsConnectionState.reconnecting);
    _scheduleReconnect();
  }

  void _onDone() {
    _heartbeatTimer?.cancel();
    _setState(WsConnectionState.reconnecting);
    _scheduleReconnect();
  }

  void _scheduleReconnect() {
    if (!_reconnect) return;
    if (_reconnectAttempt >= _maxReconnectAttempts) {
      _setState(WsConnectionState.disconnected);
      return;
    }
    _reconnectTimer?.cancel();
    _reconnectAttempt++;
    final delay = (_reconnectAttempt * 2).clamp(1, _maxReconnectDelay);
    _reconnectTimer = Timer(Duration(seconds: delay), _doConnect);
    _setState(WsConnectionState.reconnecting);
  }

  void sendMessage(String text, {String? sessionId}) {
    if (_channel == null || !isConnected) return;
    _channel!.sink.add(jsonEncode({
      'type': 'chat',
      'data': {'message': text, 'sessionId': sessionId},
      'sessionId': sessionId,
    }));
  }

  void sendToPeer(String targetPeerId, String text, {String? sessionId}) {
    if (_channel == null || !isConnected) return;
    _channel!.sink.add(jsonEncode({
      'type': 'message',
      'data': {'message': text, 'to': targetPeerId},
    }));
  }

  void disconnect() {
    _reconnect = false;
    _reconnectTimer?.cancel();
    _heartbeatTimer?.cancel();
    _channel?.sink.close();
    _setState(WsConnectionState.disconnected);
  }

  void dispose() {
    disconnect();
    _messageController.close();
    _stateController.close();
  }
}
