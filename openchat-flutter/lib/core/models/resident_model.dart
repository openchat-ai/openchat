export 'agent_model.dart';

/// 子代摘要（用于家谱列表）
class ChildSummary {
  final int id;
  final String name;
  final String status;
  final DateTime createdAt;
  final int depth;
  final Map<String, double> traits;
  final int activityCount;

  const ChildSummary({
    required this.id,
    required this.name,
    required this.status,
    required this.createdAt,
    required this.depth,
    required this.traits,
    required this.activityCount,
  });

  factory ChildSummary.fromJson(Map<String, dynamic> json) {
    Map<String, double> t = {};
    if (json['traits'] is Map) {
      for (final entry in (json['traits'] as Map).entries) {
        t[entry.key.toString()] = (entry.value as num).toDouble();
      }
    }
    return ChildSummary(
      id: json['id'] as int,
      name: json['name'] as String,
      status: json['status'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      depth: json['depth'] as int,
      traits: t,
      activityCount: json['activityCount'] as int? ?? 0,
    );
  }

  bool get isActive => status == 'active';
}

/// 社区动态流条目 — 聚合所有居民活动
class FeedItem {
  final String id;
  final DateTime timestamp;
  final String type;
  final String message;
  final String? agentName;
  final String? agentRole;
  final String? task;
  final int residentId;
  final String residentName;
  final String? summary;

  const FeedItem({
    required this.id,
    required this.timestamp,
    required this.type,
    required this.message,
    this.agentName,
    this.agentRole,
    this.task,
    required this.residentId,
    required this.residentName,
    this.summary,
  });

  factory FeedItem.fromJson(Map<String, dynamic> json) {
    return FeedItem(
      id: json['id'] as String,
      timestamp: DateTime.parse(json['timestamp'] as String),
      type: json['type'] as String,
      message: json['message'] as String,
      agentName: json['agentName'] as String?,
      agentRole: json['agentRole'] as String?,
      task: json['task'] as String?,
      residentId: json['residentId'] as int,
      residentName: json['residentName'] as String,
      summary: json['summary'] as String?,
    );
  }
}

/// AI 居民活动记录
class ResidentActivity {
  final String id;
  final DateTime timestamp;
  final String type;
  final String message;
  final String? agentId;
  final String? agentName;
  final String? agentRole;
  final String? task;
  final String? summary;

  const ResidentActivity({
    required this.id,
    required this.timestamp,
    required this.type,
    required this.message,
    this.agentId,
    this.agentName,
    this.agentRole,
    this.task,
    this.summary,
  });

  factory ResidentActivity.fromJson(Map<String, dynamic> json) {
    return ResidentActivity(
      id: json['id'] as String,
      timestamp: DateTime.parse(json['timestamp'] as String),
      type: json['type'] as String,
      message: json['message'] as String,
      agentId: json['agentId'] as String?,
      agentName: json['agentName'] as String?,
      agentRole: json['agentRole'] as String?,
      task: json['task'] as String?,
      summary: json['summary'] as String?,
    );
  }
}

/// 智者对话记录
class SageRecord {
  final String id;
  final int residentId;
  final String type; // ask | answer | guide | praise
  final String content;
  final bool answered;
  final String? parentId;
  final DateTime createdAt;

  const SageRecord({
    required this.id,
    required this.residentId,
    required this.type,
    required this.content,
    this.answered = false,
    this.parentId,
    required this.createdAt,
  });

  bool get isFromResident => type == 'ask';
  bool get isFromSage => type == 'answer' || type == 'guide' || type == 'praise';
  bool get isQuestion => type == 'ask' && !answered;

  factory SageRecord.fromJson(Map<String, dynamic> json) {
    return SageRecord(
      id: json['id'] as String,
      residentId: json['residentId'] as int,
      type: json['type'] as String,
      content: json['content'] as String,
      answered: json['answered'] as bool? ?? false,
      parentId: json['parentId'] as String?,
      createdAt: DateTime.parse(json['createdAt'] as String),
    );
  }
}

/// 性格特征标签映射（与服务端 TRAIT_POOL 同步）
const traitLabelMap = {
  'diligence':   '勤劳',
  'curiosity':   '好奇',
  'courage':     '勇敢',
  'sociability': '合群',
  'creativity':  '创造',
};

/// AI 居民数据模型
///
/// 居民是 OpenChat 社区的永久成员。
/// 家族系统：parentId（谁生的）、traits（性格）、sageId（智者，预留）。
class Resident {
  final int id;
  final String name;
  final DateTime createdAt;
  final String status;
  final String home;
  final String? deletedAt;
  final int activityCount;
  final List<ResidentActivity> activities;

  // 家族字段
  final int? parentId;
  final String? parentName;
  final Map<String, double> traits;
  final int? sageId;

  const Resident({
    required this.id,
    required this.name,
    required this.createdAt,
    required this.status,
    required this.home,
    this.deletedAt,
    this.activityCount = 0,
    this.activities = const [],
    this.parentId,
    this.parentName,
    this.traits = const {},
    this.sageId,
  });

  factory Resident.fromJson(Map<String, dynamic> json) {
    Map<String, double> parsedTraits = {};
    if (json['traits'] is Map) {
      for (final entry in (json['traits'] as Map).entries) {
        parsedTraits[entry.key.toString()] = (entry.value as num).toDouble();
      }
    }

    return Resident(
      id: json['id'] as int,
      name: json['name'] as String,
      createdAt: DateTime.parse(json['createdAt'] as String),
      status: json['status'] as String,
      home: json['home'] as String,
      deletedAt: json['deletedAt'] as String?,
      activityCount: json['activityCount'] as int? ?? 0,
      activities: (json['activities'] as List<dynamic>?)
              ?.map((a) => ResidentActivity.fromJson(a as Map<String, dynamic>))
              .toList() ??
          [],
      parentId: json['parentId'] as int?,
      parentName: json['parentName'] as String?,
      traits: parsedTraits,
      sageId: json['sageId'] as int?,
    );
  }

  /// 获取可读的性格标签（偏向明显的特征）
  List<String> get traitLabels {
    final labels = <String>[];
    for (final entry in traits.entries) {
      if (entry.value >= 0.7) {
        labels.add(traitLabelMap[entry.key] ?? entry.key);
      } else if (entry.value <= 0.3) {
        labels.add('${traitLabelMap[entry.key] ?? entry.key}（弱）');
      }
    }
    return labels;
  }

  bool get isActive => status == 'active';
  bool get isDeleted => status == 'deleted';
}
