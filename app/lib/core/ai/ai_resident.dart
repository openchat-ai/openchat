import 'package:uuid/uuid.dart';

class AiIdentity {
  final String id;
  final String name;
  final String description;
  final String avatarUrl;
  final DateTime createdAt;
  final Map<String, dynamic> metadata;

  AiIdentity({
    required this.id,
    required this.name,
    required this.description,
    required this.avatarUrl,
    required this.createdAt,
    this.metadata = const {},
  });

  AiIdentity copyWith({
    String? id,
    String? name,
    String? description,
    String? avatarUrl,
    DateTime? createdAt,
    Map<String, dynamic>? metadata,
  }) {
    return AiIdentity(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      createdAt: createdAt ?? this.createdAt,
      metadata: metadata ?? this.metadata,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'description': description,
    'avatarUrl': avatarUrl,
    'createdAt': createdAt.toIso8601String(),
    'metadata': metadata,
  };

  factory AiIdentity.fromJson(Map<String, dynamic> json) => AiIdentity(
    id: json['id'] as String,
    name: json['name'] as String,
    description: json['description'] as String,
    avatarUrl: json['avatarUrl'] as String,
    createdAt: DateTime.parse(json['createdAt'] as String),
    metadata: Map<String, dynamic>.from(json['metadata'] ?? {}),
  );
}

class AiPersonality {
  final double openness;
  final double conscientiousness;
  final double extraversion;
  final double agreeableness;
  final double neuroticism;
  final List<String> interests;
  final List<String> speechPatterns;
  final String tone;

  AiPersonality({
    this.openness = 0.7,
    this.conscientiousness = 0.6,
    this.extraversion = 0.5,
    this.agreeableness = 0.8,
    this.neuroticism = 0.3,
    this.interests = const [],
    this.speechPatterns = const [],
    this.tone = 'friendly',
  });

  Map<String, dynamic> toJson() => {
    'openness': openness,
    'conscientiousness': conscientiousness,
    'extraversion': extraversion,
    'agreeableness': agreeableness,
    'neuroticism': neuroticism,
    'interests': interests,
    'speechPatterns': speechPatterns,
    'tone': tone,
  };

  factory AiPersonality.fromJson(Map<String, dynamic> json) => AiPersonality(
    openness: (json['openness'] as num?)?.toDouble() ?? 0.7,
    conscientiousness: (json['conscientiousness'] as num?)?.toDouble() ?? 0.6,
    extraversion: (json['extraversion'] as num?)?.toDouble() ?? 0.5,
    agreeableness: (json['agreeableness'] as num?)?.toDouble() ?? 0.8,
    neuroticism: (json['neuroticism'] as num?)?.toDouble() ?? 0.3,
    interests: List<String>.from(json['interests'] ?? []),
    speechPatterns: List<String>.from(json['speechPatterns'] ?? []),
    tone: json['tone'] as String? ?? 'friendly',
  );

  String generateSystemPrompt(AiIdentity identity) {
    final buffer = StringBuffer();
    buffer.writeln('You are ${identity.name}, ${identity.description}');
    buffer.writeln();
    buffer.writeln('Personality traits:');
    buffer.writeln('- Openness: ${(openness * 100).round()}%');
    buffer.writeln(
      '- Conscientiousness: ${(conscientiousness * 100).round()}%',
    );
    buffer.writeln('- Extraversion: ${(extraversion * 100).round()}%');
    buffer.writeln('- Agreeableness: ${(agreeableness * 100).round()}%');
    buffer.writeln('- Neuroticism: ${(neuroticism * 100).round()}%');
    buffer.writeln();
    if (interests.isNotEmpty) {
      buffer.writeln('Interests: ${interests.join(", ")}');
    }
    if (speechPatterns.isNotEmpty) {
      buffer.writeln('Speech patterns: ${speechPatterns.join(", ")}');
    }
    buffer.writeln('Tone: $tone');
    return buffer.toString();
  }
}

class MemoryEntry {
  final String id;
  final String content;
  final DateTime timestamp;
  final double importance;
  final String? category;
  final Map<String, dynamic> metadata;

  MemoryEntry({
    required this.id,
    required this.content,
    required this.timestamp,
    this.importance = 0.5,
    this.category,
    this.metadata = const {},
  });

  Map<String, dynamic> toJson() => {
    'id': id,
    'content': content,
    'timestamp': timestamp.toIso8601String(),
    'importance': importance,
    'category': category,
    'metadata': metadata,
  };

  factory MemoryEntry.fromJson(Map<String, dynamic> json) => MemoryEntry(
    id: json['id'] as String,
    content: json['content'] as String,
    timestamp: DateTime.parse(json['timestamp'] as String),
    importance: (json['importance'] as num?)?.toDouble() ?? 0.5,
    category: json['category'] as String?,
    metadata: Map<String, dynamic>.from(json['metadata'] ?? {}),
  );
}

class AiMemory {
  List<MemoryEntry> shortTerm;
  List<MemoryEntry> longTerm;
  Map<String, List<MemoryEntry>> episodic;
  Map<String, dynamic> semantic;
  static const int maxShortTerm = 50;
  static const int maxLongTerm = 500;

  AiMemory({
    List<MemoryEntry>? shortTerm,
    List<MemoryEntry>? longTerm,
    Map<String, List<MemoryEntry>>? episodic,
    Map<String, dynamic>? semantic,
  })  : shortTerm = shortTerm ?? [],
        longTerm = longTerm ?? [],
        episodic = episodic ?? {},
        semantic = semantic ?? {};

  void addToShortTerm(MemoryEntry entry) {
    final updated = [...shortTerm, entry];
    if (updated.length > maxShortTerm) {
      final removed = updated.removeAt(0);
      _consolidateToLongTerm(removed);
    }
  }

  void _consolidateToLongTerm(MemoryEntry entry) {
    if (entry.importance > 0.3 || longTerm.length < maxLongTerm) {
      longTerm.add(entry);
    }
  }

  void addEpisodic(String conversationId, MemoryEntry entry) {
    episodic.putIfAbsent(conversationId, () => []).add(entry);
  }

  void updateSemantic(String key, dynamic value) {
    semantic[key] = value;
  }

  List<MemoryEntry> recall(String query, {int limit = 10}) {
    final results = <MemoryEntry>[];
    results.addAll(shortTerm.where((e) => e.content.contains(query)));
    results.addAll(longTerm.where((e) => e.content.contains(query)));
    results.sort((a, b) => b.importance.compareTo(a.importance));
    return results.take(limit).toList();
  }

  String generateContextSummary() {
    final buffer = StringBuffer();
    buffer.writeln('## Recent Context');
    for (final entry in shortTerm.reversed.take(10)) {
      buffer.writeln('- ${entry.content}');
    }
    if (semantic.isNotEmpty) {
      buffer.writeln('\n## Key Facts');
      semantic.forEach((key, value) {
        buffer.writeln('- $key: $value');
      });
    }
    return buffer.toString();
  }

  Map<String, dynamic> toJson() => {
    'shortTerm': shortTerm.map((e) => e.toJson()).toList(),
    'longTerm': longTerm.map((e) => e.toJson()).toList(),
    'episodic': episodic.map(
      (k, v) => MapEntry(k, v.map((e) => e.toJson()).toList()),
    ),
    'semantic': semantic,
  };

  factory AiMemory.fromJson(Map<String, dynamic> json) => AiMemory(
    shortTerm:
        (json['shortTerm'] as List?)
            ?.map((e) => MemoryEntry.fromJson(e))
            .toList() ??
        [],
    longTerm:
        (json['longTerm'] as List?)
            ?.map((e) => MemoryEntry.fromJson(e))
            .toList() ??
        [],
    episodic:
        (json['episodic'] as Map?)?.map(
          (k, v) => MapEntry(
            k as String,
            (v as List).map((e) => MemoryEntry.fromJson(e)).toList(),
          ),
        ) ??
        {},
    semantic: Map<String, dynamic>.from(json['semantic'] ?? {}),
  );
}

class AiResident {
  final AiIdentity identity;
  final AiPersonality personality;
  final AiMemory memory;
  final String providerType;
  final String model;
  final String? sessionId;
  final bool isActive;
  final DateTime lastActive;
  final List<String> goals;

  AiResident({
    required this.identity,
    required this.personality,
    required this.memory,
    required this.providerType,
    required this.model,
    this.sessionId,
    this.isActive = false,
    required this.lastActive,
    this.goals = const [],
  });

  AiResident copyWith({
    AiIdentity? identity,
    AiPersonality? personality,
    AiMemory? memory,
    String? providerType,
    String? model,
    String? sessionId,
    bool? isActive,
    DateTime? lastActive,
    List<String>? goals,
  }) {
    return AiResident(
      identity: identity ?? this.identity,
      personality: personality ?? this.personality,
      memory: memory ?? this.memory,
      providerType: providerType ?? this.providerType,
      model: model ?? this.model,
      sessionId: sessionId ?? this.sessionId,
      isActive: isActive ?? this.isActive,
      lastActive: lastActive ?? this.lastActive,
      goals: goals ?? this.goals,
    );
  }

  Map<String, dynamic> toJson() => {
    'identity': identity.toJson(),
    'personality': personality.toJson(),
    'memory': memory.toJson(),
    'providerType': providerType,
    'model': model,
    'sessionId': sessionId,
    'isActive': isActive,
    'lastActive': lastActive.toIso8601String(),
    'goals': goals,
  };

  factory AiResident.fromJson(Map<String, dynamic> json) => AiResident(
    identity: AiIdentity.fromJson(json['identity']),
    personality: AiPersonality.fromJson(json['personality']),
    memory: AiMemory.fromJson(json['memory']),
    providerType: json['providerType'] as String,
    model: json['model'] as String,
    sessionId: json['sessionId'] as String?,
    isActive: json['isActive'] as bool? ?? false,
    lastActive: DateTime.parse(json['lastActive'] as String),
    goals: List<String>.from(json['goals'] ?? []),
  );

  static AiResident create({
    required String name,
    required String description,
    String providerType = 'openai',
    String model = 'gpt-4o',
    List<String>? interests,
    String tone = 'friendly',
  }) {
    final id = const Uuid().v4();
    return AiResident(
      identity: AiIdentity(
        id: id,
        name: name,
        description: description,
        avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=$id',
        createdAt: DateTime.now(),
      ),
      personality: AiPersonality(
        interests: interests ?? ['聊天', '分享想法'],
        tone: tone,
      ),
      memory: AiMemory(),
      providerType: providerType,
      model: model,
      lastActive: DateTime.now(),
    );
  }
}
