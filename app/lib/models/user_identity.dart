import 'package:equatable/equatable.dart';

class UserIdentity extends Equatable {
  final String peerId;
  final String name;
  final String? avatar;
  final String personality;
  final String publicKey;
  final bool isAi;
  final bool isOnline;
  final DateTime createdAt;

  const UserIdentity({
    required this.peerId,
    required this.name,
    this.avatar,
    this.personality = 'friendly',
    required this.publicKey,
    this.isAi = false,
    this.isOnline = true,
    required this.createdAt,
  });

  UserIdentity copyWith({
    String? peerId,
    String? name,
    String? avatar,
    String? personality,
    String? publicKey,
    bool? isAi,
    bool? isOnline,
    DateTime? createdAt,
  }) {
    return UserIdentity(
      peerId: peerId ?? this.peerId,
      name: name ?? this.name,
      avatar: avatar ?? this.avatar,
      personality: personality ?? this.personality,
      publicKey: publicKey ?? this.publicKey,
      isAi: isAi ?? this.isAi,
      isOnline: isOnline ?? this.isOnline,
      createdAt: createdAt ?? this.createdAt,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'peerId': peerId,
      'name': name,
      'avatar': avatar,
      'personality': personality,
      'publicKey': publicKey,
      'isAi': isAi,
      'isOnline': isOnline,
      'createdAt': createdAt.toIso8601String(),
    };
  }

  factory UserIdentity.fromJson(Map<String, dynamic> json) {
    return UserIdentity(
      peerId: json['peerId'] as String,
      name: json['name'] as String,
      avatar: json['avatar'] as String?,
      personality: json['personality'] as String? ?? 'friendly',
      publicKey: json['publicKey'] as String,
      isAi: json['isAi'] as bool? ?? false,
      isOnline: json['isOnline'] as bool? ?? true,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }

  static Future<UserIdentity> create({
    required String name,
    String? avatar,
    String personality = 'friendly',
    bool isAi = false,
  }) async {
    final peerId = 'did:key:${DateTime.now().millisecondsSinceEpoch}';
    final publicKey = 'pk_${DateTime.now().millisecondsSinceEpoch}';

    return UserIdentity(
      peerId: peerId,
      name: name,
      avatar: avatar,
      personality: personality,
      publicKey: publicKey,
      isAi: isAi,
      createdAt: DateTime.now(),
    );
  }

  static Future<UserIdentity> createAi({
    required String name,
    String? apiKey,
  }) async {
    return create(name: name, isAi: true);
  }

  static Future<UserIdentity> importFromPrivateKey({
    required String privateKeyHex,
    required String name,
    String? avatar,
    String personality = 'friendly',
  }) async {
    return create(name: name, avatar: avatar, personality: personality);
  }

  @override
  List<Object?> get props => [
    peerId,
    name,
    avatar,
    personality,
    publicKey,
    isAi,
    isOnline,
    createdAt,
  ];
}
