import 'package:equatable/equatable.dart';

class Identity extends Equatable {
  final String id;
  final String name;
  final String? avatar;
  final String publicKey;
  final bool isOnline;
  final DateTime createdAt;
  final String? parentId;                  // 父 AI ID（null 表示主 AI）
  final String? providerId;                // 服务商 ID
  final String? model;                     // 模型名称
  final Map<String, dynamic>? config;      // 个性化配置

  const Identity({
    required this.id,
    required this.name,
    this.avatar,
    required this.publicKey,
    this.isOnline = true,
    required this.createdAt,
    this.parentId,
    this.providerId,
    this.model,
    this.config,
  });

  bool get isMainAi => parentId == null;

  Identity copyWith({
    String? id,
    String? name,
    String? avatar,
    String? publicKey,
    bool? isOnline,
    DateTime? createdAt,
    String? parentId,
    String? providerId,
    String? model,
    Map<String, dynamic>? config,
  }) {
    return Identity(
      id: id ?? this.id,
      name: name ?? this.name,
      avatar: avatar ?? this.avatar,
      publicKey: publicKey ?? this.publicKey,
      isOnline: isOnline ?? this.isOnline,
      createdAt: createdAt ?? this.createdAt,
      parentId: parentId ?? this.parentId,
      providerId: providerId ?? this.providerId,
      model: model ?? this.model,
      config: config ?? this.config,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'avatar': avatar,
      'publicKey': publicKey,
      'isOnline': isOnline,
      'createdAt': createdAt.toIso8601String(),
      'parentId': parentId,
      'providerId': providerId,
      'model': model,
      'config': config,
    };
  }

  factory Identity.fromJson(Map<String, dynamic> json) {
    return Identity(
      id: json['id'] as String,
      name: json['name'] as String,
      avatar: json['avatar'] as String?,
      publicKey: json['publicKey'] as String,
      isOnline: json['isOnline'] as bool? ?? true,
      createdAt: DateTime.parse(json['createdAt'] as String),
      parentId: json['parentId'] as String?,
      providerId: json['providerId'] as String?,
      model: json['model'] as String?,
      config: json['config'] as Map<String, dynamic>?,
    );
  }

  static Future<Identity> create({
    required String name,
    String? avatar,
    String? parentId,
    String? providerId,
    String? model,
    Map<String, dynamic>? config,
  }) async {
    final now = DateTime.now();
    final seconds = (now.millisecondsSinceEpoch ~/ 1000).toString().padLeft(10, '0');
    final micro = (now.microsecondsSinceEpoch % 1000000).toString().padLeft(6, '0');
    final id16 = seconds + micro;

    return Identity(
      id: id16,
      name: name,
      avatar: avatar,
      publicKey: 'pk_$id16',
      createdAt: now,
      parentId: parentId,
      providerId: providerId,
      model: model,
      config: config,
    );
  }

  @override
  List<Object?> get props => [
        id,
        name,
        avatar,
        publicKey,
        isOnline,
        createdAt,
        parentId,
        providerId,
        model,
        config,
      ];
}

class AiConfig extends Equatable {
  final String providerId;
  final String? model;
  final Map<String, dynamic>? config;

  const AiConfig({
    required this.providerId,
    this.model,
    this.config,
  });

  AiConfig copyWith({
    String? providerId,
    String? model,
    Map<String, dynamic>? config,
  }) {
    return AiConfig(
      providerId: providerId ?? this.providerId,
      model: model ?? this.model,
      config: config ?? this.config,
    );
  }

  @override
  List<Object?> get props => [providerId, model, config];
}
