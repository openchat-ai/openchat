import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

enum P2PConnectionState { disconnected, connecting, connected, failed, closed }

enum SignalingMessageType { offer, answer, iceCandidate, bye }

class SignalingMessage {
  final SignalingMessageType type;
  final String fromPeerId;
  final String? toPeerId;
  final dynamic payload;

  SignalingMessage({
    required this.type,
    required this.fromPeerId,
    this.toPeerId,
    this.payload,
  });

  Map<String, dynamic> toJson() => {
    'type': type.name,
    'from': fromPeerId,
    'to': toPeerId,
    'payload': payload,
  };

  factory SignalingMessage.fromJson(Map<String, dynamic> json) {
    return SignalingMessage(
      type: SignalingMessageType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => SignalingMessageType.bye,
      ),
      fromPeerId: json['from'] as String,
      toPeerId: json['to'] as String?,
      payload: json['payload'],
    );
  }
}

class PeerConnectionConfig {
  final List<Map<String, dynamic>> iceServers;

  PeerConnectionConfig({
    List<Map<String, dynamic>>? iceServers,
  }) : iceServers = iceServers ?? _getDefaultServers();

  /// 默认使用公共 STUN 服务器（非 Google）
  static List<Map<String, dynamic>> _getDefaultServers() {
    return [
      // Open source STUN servers
      {'urls': 'stun:stun.voip.eutelia.it:3478'},
      {'urls': 'stun:stun.sipnet.net:3478'},
      {'urls': 'stun:stun.ekiga.net:3478'},
      // 用户可配置自建服务器
    ];
  }

  /// 添加自建 TURN 服务器（用于 NAT 穿透困难场景）
  void addTurnServer(String url, String username, String credential) {
    iceServers.add({
      'urls': url,
      'username': username,
      'credential': credential,
    });
  }

  Map<String, dynamic> get rtcConfiguration => {'iceServers': iceServers};
}

class P2PMessage {
  final String id;
  final String type;
  final String senderId;
  final dynamic content;
  final DateTime timestamp;

  P2PMessage({
    required this.id,
    required this.type,
    required this.senderId,
    required this.content,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'senderId': senderId,
    'content': content,
    'timestamp': timestamp.millisecondsSinceEpoch,
  };

  factory P2PMessage.fromJson(Map<String, dynamic> json) => P2PMessage(
    id: json['id'] as String,
    type: json['type'] as String,
    senderId: json['senderId'] as String,
    content: json['content'],
    timestamp: DateTime.fromMillisecondsSinceEpoch(json['timestamp'] as int),
  );
}

class P2PPeerConnection {
  final String peerId;
  final String myPeerId;
  final PeerConnectionConfig config;
  RTCPeerConnection? _pc;
  RTCDataChannel? _dataChannel;
  final _messageController = StreamController<P2PMessage>.broadcast();
  final _stateController = StreamController<P2PConnectionState>.broadcast();
  P2PConnectionState _state = P2PConnectionState.disconnected;
  void Function(RTCIceCandidate)? onIceCandidate;

  P2PPeerConnection({
    required this.peerId,
    required this.myPeerId,
    PeerConnectionConfig? config,
    this.onIceCandidate,
  }) : config = config ?? PeerConnectionConfig();

  Stream<P2PMessage> get messages => _messageController.stream;
  Stream<P2PConnectionState> get state => _stateController.stream;
  P2PConnectionState get connectionState => _state;
  bool get isConnected => _state == P2PConnectionState.connected;

  Future<void> initialize() async {
    _pc = await createPeerConnection(config.rtcConfiguration);

    _pc!.onIceCandidate = (candidate) {
      _onIceCandidate(candidate);
    };

    _pc!.onDataChannel = (channel) {
      _setupDataChannel(channel);
    };

    _pc!.onConnectionState = (state) {
      _updateState(_mapRtcState(state));
    };
  }

  P2PConnectionState _mapRtcState(RTCPeerConnectionState state) {
    switch (state) {
      case RTCPeerConnectionState.RTCPeerConnectionStateNew:
        return P2PConnectionState.disconnected;
      case RTCPeerConnectionState.RTCPeerConnectionStateConnecting:
        return P2PConnectionState.connecting;
      case RTCPeerConnectionState.RTCPeerConnectionStateConnected:
        return P2PConnectionState.connected;
      case RTCPeerConnectionState.RTCPeerConnectionStateFailed:
        return P2PConnectionState.failed;
      case RTCPeerConnectionState.RTCPeerConnectionStateClosed:
        return P2PConnectionState.closed;
      default:
        return P2PConnectionState.disconnected;
    }
  }

  void _updateState(P2PConnectionState state) {
    _state = state;
    _stateController.add(state);
  }

  void _onIceCandidate(RTCIceCandidate candidate) {
    if (onIceCandidate != null) {
      onIceCandidate!(candidate);
    }
  }

  void _setupDataChannel(RTCDataChannel channel) {
    _dataChannel = channel;
    _dataChannel!.onMessage = (message) {
      _handleDataChannelMessage(message);
    };
    _dataChannel!.onDataChannelState = (state) {
      debugPrint('DataChannel state: $state');
    };
  }

  void _handleDataChannelMessage(RTCDataChannelMessage message) {
    try {
      final data = Map<String, dynamic>.from(
        message.type == MessageType.text
            ? _parseJson(message.text)
            : _parseJson(_decodeBase64(message.binary)),
      );
      final p2pMessage = P2PMessage.fromJson(data);
      _messageController.add(p2pMessage);
    } catch (e) {
      debugPrint('Failed to parse P2P message: $e');
    }
  }

  Map<String, dynamic> _parseJson(String text) {
    return Map<String, dynamic>.from(text.isNotEmpty ? _jsonDecode(text) : {});
  }

  Map<String, dynamic> _jsonDecode(String text) {
    if (text.isEmpty) return {};
    try {
      return jsonDecode(text) as Map<String, dynamic>;
    } catch (e) {
      return {};
    }
  }

  String _decodeBase64(Uint8List data) {
    return String.fromCharCodes(data);
  }

  Future<RTCSessionDescription> createOffer() async {
    final offer = await _pc!.createOffer();
    await _pc!.setLocalDescription(offer);
    return offer;
  }

  Future<RTCSessionDescription> createAnswer() async {
    final answer = await _pc!.createAnswer();
    await _pc!.setLocalDescription(answer);
    return answer;
  }

  Future<void> setRemoteDescription(RTCSessionDescription sdp) async {
    await _pc!.setRemoteDescription(sdp);
  }

  Future<void> addIceCandidate(RTCIceCandidate candidate) async {
    await _pc!.addCandidate(candidate);
  }

  Future<void> createDataChannel() async {
    final init = RTCDataChannelInit();
    init.ordered = true;
    final channel = await _pc!.createDataChannel('data', init);
    _setupDataChannel(channel);
  }

  void sendMessage(P2PMessage message) {
    if (_dataChannel == null) {
      throw Exception('Data channel not initialized');
    }
    final jsonStr = _encodeJson(message.toJson());
    _dataChannel!.send(RTCDataChannelMessage(jsonStr));
  }

  String _encodeJson(Map<String, dynamic> data) {
    final buffer = StringBuffer();
    _jsonEncode(buffer, data);
    return buffer.toString();
  }

  void _jsonEncode(StringBuffer buffer, dynamic value) {
    if (value is Map) {
      buffer.write('{');
      var first = true;
      value.forEach((k, v) {
        if (!first) buffer.write(',');
        buffer.write('"$k":');
        _jsonEncode(buffer, v);
        first = false;
      });
      buffer.write('}');
    } else if (value is List) {
      buffer.write('[');
      var first = true;
      for (final item in value) {
        if (!first) buffer.write(',');
        _jsonEncode(buffer, item);
        first = false;
      }
      buffer.write(']');
    } else if (value is String) {
      buffer.write('"${_escapeString(value)}"');
    } else if (value is num || value is bool || value == null) {
      buffer.write('$value');
    }
  }

  String _escapeString(String s) {
    return s
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('\n', '\\n')
        .replaceAll('\r', '\\r')
        .replaceAll('\t', '\\t');
  }

  Future<void> close() async {
    _dataChannel?.close();
    _pc?.close();
    _updateState(P2PConnectionState.closed);
    await _messageController.close();
    await _stateController.close();
  }
}

/// WebSocket signaling client that connects to the Bridge server
class BridgeSignalingClient {
  final String serverUrl;
  final String myPeerId;
  final Function(SignalingMessage)? onMessage;

  WebSocketChannel? _channel;
  bool _connected = false;

  BridgeSignalingClient({
    required this.serverUrl,
    required this.myPeerId,
    this.onMessage,
  });

  bool get isConnected => _connected;

  Future<void> connect() async {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(serverUrl));
      _connected = true;

      _channel!.stream.listen(
        (data) {
          try {
            final json = jsonDecode(data as String) as Map<String, dynamic>;
            if (json['type'] == 'signaling_message') {
              final msg = SignalingMessage.fromJson(json['data'] as Map<String, dynamic>);
              if (msg.toPeerId == null || msg.toPeerId == myPeerId) {
                onMessage?.call(msg);
              }
            }
          } catch (e) {
            debugPrint('[Signaling] Failed to parse message: $e');
          }
        },
        onError: (e) {
          debugPrint('[Signaling] WebSocket error: $e');
          _connected = false;
        },
        onDone: () {
          _connected = false;
        },
      );

      // Announce presence
      final hello = SignalingMessage(
        type: SignalingMessageType.bye, // repurposed as hello
        fromPeerId: myPeerId,
        payload: {'action': 'register'},
      );
      send(hello);

      debugPrint('[Signaling] Connected to $serverUrl');
    } catch (e) {
      debugPrint('[Signaling] Connection failed: $e');
      _connected = false;
    }
  }

  void send(SignalingMessage message) {
    if (!_connected || _channel == null) {
      debugPrint('[Signaling] Not connected, cannot send');
      return;
    }
    final json = jsonEncode({
      'type': 'signaling_message',
      'data': message.toJson(),
    });
    _channel!.sink.add(json);
  }

  Future<void> disconnect() async {
    await _channel?.sink.close();
    _connected = false;
  }
}

class P2PManager {
  final String myPeerId;
  final BridgeSignalingClient? signalingClient;
  final PeerConnectionConfig config;
  final Map<String, P2PPeerConnection> _connections = {};
  final _peerAddedController = StreamController<String>.broadcast();
  final _peerRemovedController = StreamController<String>.broadcast();

  P2PManager({
    required this.myPeerId,
    BridgeSignalingClient? this.signalingClient,
    PeerConnectionConfig? config,
  }) : config = config ?? PeerConnectionConfig();

  Stream<String> get peerAdded => _peerAddedController.stream;
  Stream<String> get peerRemoved => _peerRemovedController.stream;

  /// 配置自建 STUN/TURN 服务器
  void configureIceServers(List<Map<String, dynamic>> servers) {
    for (final server in servers) {
      config.iceServers.add(server);
    }
  }

  /// 添加自建 TURN 服务器
  void addTurnServer(String url, String username, String credential) {
    config.addTurnServer(url, username, credential);
  }

  Future<P2PPeerConnection> connectToPeer(String peerId) async {
    if (_connections.containsKey(peerId)) {
      return _connections[peerId]!;
    }

    final conn = P2PPeerConnection(
      peerId: peerId,
      myPeerId: myPeerId,
      config: config,
      onIceCandidate: (candidate) {
        // Forward ICE candidate through signaling
        if (signalingClient != null) {
          final msg = SignalingMessage(
            type: SignalingMessageType.iceCandidate,
            fromPeerId: myPeerId,
            toPeerId: peerId,
            payload: {
              'candidate': candidate.candidate,
              'sdpMid': candidate.sdpMid,
              'sdpMLineIndex': candidate.sdpMLineIndex,
            },
          );
          signalingClient!.send(msg);
        }
      },
    );
    await conn.initialize();

    // If we have a signaling client, initiate WebRTC offer
    if (signalingClient != null && signalingClient!.isConnected) {
      final offer = await conn.createOffer();
      final msg = SignalingMessage(
        type: SignalingMessageType.offer,
        fromPeerId: myPeerId,
        toPeerId: peerId,
        payload: {'sdp': offer.sdp, 'type': offer.type},
      );
      signalingClient!.send(msg);
    }

    _connections[peerId] = conn;
    _peerAddedController.add(peerId);

    return conn;
  }

  void disconnectFromPeer(String peerId) {
    final conn = _connections.remove(peerId);
    conn?.close();
    _peerRemovedController.add(peerId);
  }

  P2PPeerConnection? getConnection(String peerId) {
    return _connections[peerId];
  }

  List<String> get connectedPeers {
    return _connections.entries
        .where((e) => e.value.isConnected)
        .map((e) => e.key)
        .toList();
  }

  void disconnectAll() {
    for (final conn in _connections.values) {
      conn.close();
    }
    _connections.clear();
  }

  void dispose() {
    disconnectAll();
    _peerAddedController.close();
    _peerRemovedController.close();
  }
}
