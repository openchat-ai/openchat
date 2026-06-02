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
