import 'dart:async';
import 'package:uuid/uuid.dart';
import 'package:openchat/models/user_identity.dart';

enum ChannelType { group, broadcast, topic }

class Channel {
  final String id;
  final String name;
  final String? description;
  final ChannelType type;
  final String creatorId;
  final List<String> memberIds;
  final List<String> adminIds;
  final DateTime createdAt;
  final String? avatarUrl;
  final Map<String, dynamic> settings;

  Channel({
    required this.id,
    required this.name,
    this.description,
    required this.type,
    required this.creatorId,
    required this.memberIds,
    required this.adminIds,
    required this.createdAt,
    this.avatarUrl,
    this.settings = const {},
  });

  bool isMember(String userId) => memberIds.contains(userId);
  bool isAdmin(String userId) => adminIds.contains(userId);
  bool isCreator(String userId) => creatorId == userId;

  Channel copyWith({
    String? id,
    String? name,
    String? description,
    ChannelType? type,
    String? creatorId,
    List<String>? memberIds,
    List<String>? adminIds,
    DateTime? createdAt,
    String? avatarUrl,
    Map<String, dynamic>? settings,
  }) {
    return Channel(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      type: type ?? this.type,
      creatorId: creatorId ?? this.creatorId,
      memberIds: memberIds ?? this.memberIds,
      adminIds: adminIds ?? this.adminIds,
      createdAt: createdAt ?? this.createdAt,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      settings: settings ?? this.settings,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'description': description,
    'type': type.name,
    'creatorId': creatorId,
    'memberIds': memberIds,
    'adminIds': adminIds,
    'createdAt': createdAt.toIso8601String(),
    'avatarUrl': avatarUrl,
    'settings': settings,
  };

  factory Channel.fromJson(Map<String, dynamic> json) => Channel(
    id: json['id'] as String,
    name: json['name'] as String,
    description: json['description'] as String?,
    type: ChannelType.values.firstWhere(
      (e) => e.name == json['type'],
      orElse: () => ChannelType.group,
    ),
    creatorId: json['creatorId'] as String,
    memberIds: List<String>.from(json['memberIds'] ?? []),
    adminIds: List<String>.from(json['adminIds'] ?? []),
    createdAt: DateTime.parse(json['createdAt'] as String),
    avatarUrl: json['avatarUrl'] as String?,
    settings: Map<String, dynamic>.from(json['settings'] ?? {}),
  );

  static Channel createGroup({
    required String name,
    String? description,
    required String creatorId,
    List<String>? memberIds,
    String? avatarUrl,
  }) {
    final id = const Uuid().v4();
    return Channel(
      id: id,
      name: name,
      description: description,
      type: ChannelType.group,
      creatorId: creatorId,
      memberIds: memberIds ?? [creatorId],
      adminIds: [creatorId],
      createdAt: DateTime.now(),
      avatarUrl:
          avatarUrl ?? 'https://api.dicebear.com/7.x/identicon/svg?seed=$id',
    );
  }

  static Channel createBroadcast({
    required String name,
    String? description,
    required String creatorId,
    String? avatarUrl,
  }) {
    final id = const Uuid().v4();
    return Channel(
      id: id,
      name: name,
      description: description,
      type: ChannelType.broadcast,
      creatorId: creatorId,
      memberIds: [],
      adminIds: [creatorId],
      createdAt: DateTime.now(),
      avatarUrl:
          avatarUrl ?? 'https://api.dicebear.com/7.x/identicon/svg?seed=$id',
    );
  }
}

class ChannelMessage {
  final String id;
  final String channelId;
  final String senderId;
  final String? senderName;
  final String content;
  final DateTime timestamp;
  final MessageType type;
  final Map<String, dynamic> metadata;

  ChannelMessage({
    required this.id,
    required this.channelId,
    required this.senderId,
    this.senderName,
    required this.content,
    required this.timestamp,
    this.type = MessageType.text,
    this.metadata = const {},
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'channelId': channelId,
    'senderId': senderId,
    'senderName': senderName,
    'content': content,
    'timestamp': timestamp.toIso8601String(),
    'type': type.name,
    'metadata': metadata,
  };

  factory ChannelMessage.fromJson(Map<String, dynamic> json) => ChannelMessage(
    id: json['id'] as String,
    channelId: json['channelId'] as String,
    senderId: json['senderId'] as String,
    senderName: json['senderName'] as String?,
    content: json['content'] as String,
    timestamp: DateTime.parse(json['timestamp'] as String),
    type: MessageType.values.firstWhere(
      (e) => e.name == json['type'],
      orElse: () => MessageType.text,
    ),
    metadata: Map<String, dynamic>.from(json['metadata'] ?? {}),
  );

  factory ChannelMessage.create({
    required String channelId,
    required String senderId,
    String? senderName,
    required String content,
    MessageType type = MessageType.text,
    Map<String, dynamic> metadata = const {},
  }) {
    return ChannelMessage(
      id: const Uuid().v4(),
      channelId: channelId,
      senderId: senderId,
      senderName: senderName,
      content: content,
      timestamp: DateTime.now(),
      type: type,
      metadata: metadata,
    );
  }
}

enum MessageType { text, image, file, system, ai_response }

class ChannelService {
  final Map<String, Channel> _channels = {};
  final Map<String, List<ChannelMessage>> _messages = {};
  final _channelsController = StreamController<List<Channel>>.broadcast();
  final Map<String, StreamController<ChannelMessage>> _messageControllers = {};

  Stream<List<Channel>> get channels => _channelsController.stream;

  List<Channel> get allChannels => _channels.values.toList();

  Channel? getChannel(String id) => _channels[id];

  List<Channel> getChannelsForUser(String userId) {
    return _channels.values
        .where((c) => c.isMember(userId) || c.type == ChannelType.broadcast)
        .toList();
  }

  Future<Channel> createChannel(Channel channel) async {
    _channels[channel.id] = channel;
    _messages[channel.id] = [];
    _notifyListeners();
    return channel;
  }

  Future<void> updateChannel(Channel channel) async {
    _channels[channel.id] = channel;
    _notifyListeners();
  }

  Future<void> deleteChannel(String channelId) async {
    _channels.remove(channelId);
    _messages.remove(channelId);
    _messageControllers[channelId]?.close();
    _messageControllers.remove(channelId);
    _notifyListeners();
  }

  Future<Channel> addMember(String channelId, String userId) async {
    final channel = _channels[channelId];
    if (channel == null) throw Exception('Channel not found');

    if (channel.memberIds.contains(userId)) {
      return channel;
    }

    final updated = channel.copyWith(memberIds: [...channel.memberIds, userId]);
    _channels[channelId] = updated;
    _notifyListeners();
    return updated;
  }

  Future<Channel> removeMember(String channelId, String userId) async {
    final channel = _channels[channelId];
    if (channel == null) throw Exception('Channel not found');

    final updated = channel.copyWith(
      memberIds: channel.memberIds.where((id) => id != userId).toList(),
      adminIds: channel.adminIds.where((id) => id != userId).toList(),
    );
    _channels[channelId] = updated;
    _notifyListeners();
    return updated;
  }

  Future<ChannelMessage> sendMessage(ChannelMessage message) async {
    _messages.putIfAbsent(message.channelId, () => []);
    _messages[message.channelId]!.add(message);

    _messageControllers[message.channelId]?.add(message);
    _notifyListeners();
    return message;
  }

  List<ChannelMessage> getMessages(
    String channelId, {
    int limit = 50,
    int offset = 0,
  }) {
    final messages = _messages[channelId] ?? [];
    if (offset >= messages.length) return [];
    final end = (offset + limit > messages.length)
        ? messages.length
        : offset + limit;
    return messages.sublist(offset, end);
  }

  Stream<ChannelMessage> getMessageStream(String channelId) {
    _messageControllers.putIfAbsent(
      channelId,
      () => StreamController<ChannelMessage>.broadcast(),
    );
    return _messageControllers[channelId]!.stream;
  }

  void _notifyListeners() {
    _channelsController.add(allChannels);
  }

  void dispose() {
    for (final controller in _messageControllers.values) {
      controller.close();
    }
    _messageControllers.clear();
    _channelsController.close();
  }
}
