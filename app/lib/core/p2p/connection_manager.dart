import 'dart:async';
import 'package:uuid/uuid.dart';

class PeerMessage {
  static const String typeText = 'text';
  static const String typeImage = 'image';
  static const String typeAiCommand = 'ai_command';
  static const String typeAiResponse = 'ai_response';

  final String id;
  final String type;
  final String senderId;
  final String content;
  final DateTime timestamp;

  PeerMessage({
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

  factory PeerMessage.fromJson(Map<String, dynamic> json) => PeerMessage(
    id: json['id'] as String,
    type: json['type'] as String,
    senderId: json['senderId'] as String,
    content: json['content'] as String,
    timestamp: DateTime.fromMillisecondsSinceEpoch(json['timestamp'] as int),
  );

  factory PeerMessage.text({
    required String senderId,
    required String content,
  }) => PeerMessage(
    id: const Uuid().v4(),
    type: typeText,
    senderId: senderId,
    content: content,
    timestamp: DateTime.now(),
  );
}

abstract class ConnectionListener {
  void onMessageReceived(PeerMessage message);
  void onConnectionStateChanged(bool connected);
}

class ConnectionManager {
  final Map<String, List<ConnectionListener>> _listeners = {};
  final _messagesController = StreamController<PeerMessage>.broadcast();

  Stream<PeerMessage> get messages => _messagesController.stream;

  void addListener(String peerId, ConnectionListener listener) {
    _listeners.putIfAbsent(peerId, () => []).add(listener);
  }

  void removeListener(String peerId, ConnectionListener listener) {
    _listeners[peerId]?.remove(listener);
  }

  void sendMessage(String peerId, PeerMessage message) {
    _messagesController.add(message);
    for (final listener in _listeners[peerId] ?? []) {
      listener.onMessageReceived(message);
    }
  }

  void notifyConnectionState(String peerId, bool connected) {
    for (final listener in _listeners[peerId] ?? []) {
      listener.onConnectionStateChanged(connected);
    }
  }

  void closeAll() {
    _listeners.clear();
  }
}
