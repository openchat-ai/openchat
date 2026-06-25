// chat_message.dart — typed chat message model
//
// Replaces Map<String, dynamic> in chat screen for type safety.
//
// === invariants ===
// - sender: 'me' (user) | 'ai' (assistant) — exact string match
// - type: 'text' | 'voice' — exact string match
// - isError / hash / reasoning / key / _new 都为 optional, 默认 null/false
// - ts 用于 keyed ListView（按时间戳稳定），同时驱动 slide-in 动画
// - jsonDecode 不抛: 解析失败 → fromJson 返回默认 text message

import 'dart:convert';

enum MessageSender { me, ai }

enum MessageType { text, voice }

enum MessageStatus { pending, sent, failed }

class ChatMessage {
  final MessageSender sender;
  final MessageType type;
  final String text;
  final String time;
  final int ts;
  final int? requestTs;
  final bool isError;
  final String? hash;
  final String? reasoning;
  final String? key;
  final bool isNew;
  final MessageStatus status;

  const ChatMessage({
    required this.sender,
    required this.type,
    required this.text,
    required this.time,
    required this.ts,
    this.requestTs,
    this.isError = false,
    this.hash,
    this.reasoning,
    this.key,
    this.isNew = false,
    this.status = MessageStatus.sent,
  });

  bool get isMe => sender == MessageSender.me;
  bool get isVoice => type == MessageType.voice;
  bool get isText => type == MessageType.text;

  ChatMessage copyWith({
    MessageSender? sender,
    MessageType? type,
    String? text,
    String? time,
    int? ts,
    int? requestTs,
    bool? isError,
    String? hash,
    String? reasoning,
    String? key,
    bool? isNew,
    MessageStatus? status,
  }) => ChatMessage(
    sender: sender ?? this.sender,
    type: type ?? this.type,
    text: text ?? this.text,
    time: time ?? this.time,
    ts: ts ?? this.ts,
    requestTs: requestTs ?? this.requestTs,
    isError: isError ?? this.isError,
    hash: hash ?? this.hash,
    reasoning: reasoning ?? this.reasoning,
    key: key ?? this.key,
    isNew: isNew ?? this.isNew,
    status: status ?? this.status,
  );

  Map<String, dynamic> toMap() => {
    'sender': sender.name,
    'type': type.name,
    'text': text,
    'time': time,
    'ts': ts,
    if (requestTs != null) 'requestTs': requestTs,
    if (isError) 'isError': true,
    if (hash != null) 'hash': hash,
    if (reasoning != null) 'reasoning': reasoning,
    if (key != null) 'key': key,
    if (isNew) '_new': true,
    if (status != MessageStatus.sent) 'status': status.name,
  };

  factory ChatMessage.fromMap(Map<String, dynamic> m) {
    final sender = m['sender'] == 'me' ? MessageSender.me : MessageSender.ai;
    final type = m['type'] == 'voice' ? MessageType.voice : MessageType.text;
    MessageStatus status = MessageStatus.sent;
    if (m['status'] == 'pending') status = MessageStatus.pending;
    else if (m['status'] == 'failed') status = MessageStatus.failed;
    return ChatMessage(
      sender: sender,
      type: type,
      text: (m['text'] as String?) ?? '',
      time: (m['time'] as String?) ?? '',
      ts: (m['ts'] as int?) ?? DateTime.now().millisecondsSinceEpoch,
      requestTs: m['requestTs'] as int?,
      isError: m['isError'] == true,
      hash: m['hash'] as String?,
      reasoning: m['reasoning'] as String?,
      key: m['key'] as String?,
      isNew: m['_new'] == true,
      status: status,
    );
  }

  String toJson() => jsonEncode(toMap());
  factory ChatMessage.fromJson(String src) => ChatMessage.fromMap(jsonDecode(src) as Map<String, dynamic>);
}
