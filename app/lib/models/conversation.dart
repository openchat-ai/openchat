import 'package:equatable/equatable.dart';

class Conversation extends Equatable {
  final String peerId;
  final String lastMessage;
  final DateTime lastMessageTime;
  final int unreadCount;
  final bool isAi;

  const Conversation({
    required this.peerId,
    required this.lastMessage,
    required this.lastMessageTime,
    this.unreadCount = 0,
    this.isAi = false,
  });

  Conversation copyWith({
    String? peerId,
    String? lastMessage,
    DateTime? lastMessageTime,
    int? unreadCount,
    bool? isAi,
  }) {
    return Conversation(
      peerId: peerId ?? this.peerId,
      lastMessage: lastMessage ?? this.lastMessage,
      lastMessageTime: lastMessageTime ?? this.lastMessageTime,
      unreadCount: unreadCount ?? this.unreadCount,
      isAi: isAi ?? this.isAi,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'peerId': peerId,
      'lastMessage': lastMessage,
      'lastMessageTime': lastMessageTime.toIso8601String(),
      'unreadCount': unreadCount,
      'isAi': isAi,
    };
  }

  factory Conversation.fromJson(Map<String, dynamic> json) {
    return Conversation(
      peerId: json['peerId'] as String,
      lastMessage: json['lastMessage'] as String,
      lastMessageTime: DateTime.parse(json['lastMessageTime'] as String),
      unreadCount: json['unreadCount'] as int? ?? 0,
      isAi: json['isAi'] as bool? ?? false,
    );
  }

  @override
  List<Object?> get props => [
    peerId,
    lastMessage,
    lastMessageTime,
    unreadCount,
    isAi,
  ];
}
