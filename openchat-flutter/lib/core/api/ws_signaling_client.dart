import 'dart:async';
import 'dart:convert';
import 'package:web_socket_channel/web_socket_channel.dart';

enum CallState { idle, calling, ringing, connected, ended }

class SignalingEvent {
  final String action;
  final Map<String, dynamic> data;
  SignalingEvent({required this.action, required this.data});
}

class WsSignalingClient {
  WebSocketChannel? _channel;
  final String _host;
  final int _port;
  String? _token;
  bool _connected = false;
  String? _peerId;
  CallState _callState = CallState.idle;
  String? _remotePeerId;
  String? _roomId;
  final _eventController = StreamController<SignalingEvent>.broadcast();
  final _callStateController = StreamController<CallState>.broadcast();
  final _binaryController = StreamController<List<int>>.broadcast();

  Stream<SignalingEvent> get events => _eventController.stream;
  Stream<CallState> get callState => _callStateController.stream;
  Stream<List<int>> get binaryData => _binaryController.stream;
  bool get isConnected => _connected;
  String? get peerId => _peerId;
  String? get remotePeerId => _remotePeerId;
  String? get roomId => _roomId;
  WebSocketChannel? get channel => _channel;

  WsSignalingClient({String host = 'localhost', int port = 3800, String? token})
      : _host = host, _port = port, _token = token;

  Future<void> connect(String peerId) async {
    _peerId = peerId;
    try {
      var uriStr = 'ws://$_host:$_port/signaling';
      if (_token != null && _token!.isNotEmpty) uriStr += '?token=$_token';
      final uri = Uri.parse(uriStr);
      _channel = WebSocketChannel.connect(uri);
      await _channel!.ready;
      _connected = true;

      _channel!.sink.add(jsonEncode({
        'type': 'signaling_message',
        'data': {'action': 'register', 'peerId': peerId},
      }));

      _channel!.stream.listen(_onMessage, onError: (e) {
        _connected = false;
      }, onDone: () {
        _connected = false;
      });
    } catch (e) {
      _connected = false;
      rethrow;
    }
  }

  void _onMessage(dynamic data) {
    // Binary frame → forward to voice_client
    if (data is List<int>) {
      _binaryController.add(List<int>.from(data));
      return;
    }

    try {
      final json = jsonDecode(data as String) as Map<String, dynamic>;
      if (json['type'] != 'signaling_message') return;

      final d = json['data'] as Map<String, dynamic>;
      final action = d['action'] as String?;
      if (action == null) return;

      if (action == 'registered') {
        return;
      }

      if (action == 'call-request') {
        _remotePeerId = d['fromPeerId'] as String?;
        _roomId = d['roomId'] as String?;
        _setCallState(CallState.ringing);
        _eventController.add(SignalingEvent(action: action, data: d));
        return;
      }

      if (action == 'call-accept') {
        _remotePeerId = d['fromPeerId'] as String?;
        _roomId = d['roomId'] as String?;
        _setCallState(CallState.connected);
        _eventController.add(SignalingEvent(action: action, data: d));
        return;
      }

      if (action == 'call-reject') {
        _setCallState(CallState.ended);
        _eventController.add(SignalingEvent(action: action, data: d));
        return;
      }

      if (action == 'call-end') {
        _remotePeerId = d['fromPeerId'] as String?;
        _setCallState(CallState.ended);
        _eventController.add(SignalingEvent(action: action, data: d));
        return;
      }

      if (action == 'offer' || action == 'answer' || action == 'ice-candidate') {
        _eventController.add(SignalingEvent(action: action, data: d));
        return;
      }

      _eventController.add(SignalingEvent(action: action, data: d));
    } catch (_) {}
  }

  void _setCallState(CallState state) {
    _callState = state;
    _callStateController.add(state);
  }

  void callPeer(String targetPeerId, String roomId) {
    if (!_connected || _channel == null) return;
    _remotePeerId = targetPeerId;
    _roomId = roomId;
    _setCallState(CallState.calling);
    _channel!.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {
        'action': 'call-request',
        'toPeerId': targetPeerId,
        'roomId': roomId,
      },
    }));
  }

  void acceptCall() {
    if (!_connected || _remotePeerId == null || _channel == null) return;
    _setCallState(CallState.connected);
    _channel!.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {
        'action': 'call-accept',
        'toPeerId': _remotePeerId,
        'roomId': _roomId,
      },
    }));
  }

  void rejectCall() {
    if (!_connected || _remotePeerId == null || _channel == null) return;
    _channel!.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {
        'action': 'call-reject',
        'toPeerId': _remotePeerId,
      },
    }));
    _remotePeerId = null;
    _roomId = null;
    _setCallState(CallState.idle);
  }

  void endCall() {
    if (!_connected || _remotePeerId == null || _channel == null) return;
    _channel!.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {
        'action': 'call-end',
        'toPeerId': _remotePeerId,
      },
    }));
    _remotePeerId = null;
    _roomId = null;
    _setCallState(CallState.idle);
  }

  void sendOffer(String toPeerId, Map<String, dynamic> sdp) {
    if (!_connected || _channel == null) return;
    _channel!.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {
        'action': 'offer',
        'toPeerId': toPeerId,
        'sdp': sdp,
      },
    }));
  }

  void sendAnswer(String toPeerId, Map<String, dynamic> sdp) {
    if (!_connected || _channel == null) return;
    _channel!.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {
        'action': 'answer',
        'toPeerId': toPeerId,
        'sdp': sdp,
      },
    }));
  }

  void sendIceCandidate(String toPeerId, Map<String, dynamic> candidate) {
    if (!_connected || _channel == null) return;
    _channel!.sink.add(jsonEncode({
      'type': 'signaling_message',
      'data': {
        'action': 'ice-candidate',
        'toPeerId': toPeerId,
        'candidate': candidate,
      },
    }));
  }

  void disconnect() {
    _channel?.sink.close();
    _connected = false;
    _remotePeerId = null;
    _roomId = null;
    _setCallState(CallState.idle);
  }

  void dispose() {
    disconnect();
    _eventController.close();
    _callStateController.close();
  }
}
