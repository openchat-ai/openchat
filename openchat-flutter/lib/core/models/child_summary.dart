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
