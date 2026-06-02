import 'resident_activity.dart';

export 'resident_activity.dart';
export 'feed_item.dart';
export 'child_summary.dart';

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
