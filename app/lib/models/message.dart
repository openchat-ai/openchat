import 'package:equatable/equatable.dart';

class Message extends Equatable {
  final String id;
  final String senderId;
  final String receiverId;
  final String content;
  final String type;
  final DateTime timestamp;
  final bool isRead;
  final bool isSent;
  final bool isDelivered;

  const Message({
    required this.id,
    required this.senderId,
    required this.receiverId,
    required this.content,
    this.type = 'text',
    required this.timestamp,
    this.isRead = false,
    this.isSent = false,
    this.isDelivered = false,
  });

  Message copyWith({
    String? id,
    String? senderId,
    String? receiverId,
    String? content,
    String? type,
    DateTime? timestamp,
    bool? isRead,
    bool? isSent,
    bool? isDelivered,
  }) {
    return Message(
      id: id ?? this.id,
      senderId: senderId ?? this.senderId,
      receiverId: receiverId ?? this.receiverId,
      content: content ?? this.content,
      type: type ?? this.type,
      timestamp: timestamp ?? this.timestamp,
      isRead: isRead ?? this.isRead,
      isSent: isSent ?? this.isSent,
      isDelivered: isDelivered ?? this.isDelivered,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'senderId': senderId,
    'receiverId': receiverId,
    'content': content,
    'type': type,
    'timestamp': timestamp.millisecondsSinceEpoch,
    'isRead': isRead,
    'isSent': isSent,
    'isDelivered': isDelivered,
  };

  factory Message.fromJson(Map<String, dynamic> json) => Message(
    id: json['id'] as String,
    senderId: json['senderId'] as String,
    receiverId: json['receiverId'] as String,
    content: json['content'] as String,
    type: json['type'] as String? ?? 'text',
    timestamp: DateTime.fromMillisecondsSinceEpoch(json['timestamp'] as int),
    isRead: json['isRead'] as bool? ?? false,
    isSent: json['isSent'] as bool? ?? false,
    isDelivered: json['isDelivered'] as bool? ?? false,
  );

  @override
  List<Object?> get props => [
    id,
    senderId,
    receiverId,
    content,
    type,
    timestamp,
    isRead,
    isSent,
    isDelivered,
  ];
}
