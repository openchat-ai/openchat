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
