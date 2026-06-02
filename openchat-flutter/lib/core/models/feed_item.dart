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
