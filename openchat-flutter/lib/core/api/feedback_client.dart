import 'package:openchat_flutter/core/api/base_client.dart';

class FeedbackClient extends BaseClient {
  FeedbackClient({required super.baseUrl, super.token});

  Future<AggregatedFeedback> aggregateFeedback({required List<String> agentIds, AggregateOptions? options}) async {
    final response = await dio.post('$baseUrl/api/v1/feedback/aggregate', data: {'agentIds': agentIds, 'options': options?.toJson() ?? {}});
    return AggregatedFeedback.fromJson(response.data);
  }
}

class AggregateOptions {
  final bool normalize, deduplicate, prioritize;

  AggregateOptions({this.normalize = true, this.deduplicate = true, this.prioritize = true});

  Map<String, dynamic> toJson() => {'normalize': normalize, 'deduplicate': deduplicate, 'prioritize': prioritize};

  factory AggregateOptions.fromJson(Map<String, dynamic> json) {
    return AggregateOptions(normalize: json['normalize'] ?? true, deduplicate: json['deduplicate'] ?? true, prioritize: json['prioritize'] ?? true);
  }
}

class AggregatedFeedback {
  final String id;
  final List<String> agentIds;
  final String timestamp;
  final int feedbackCount;
  final List<FeedbackItem> feedback;
  final FeedbackSummary summary;
  final AggregateOptions options;

  AggregatedFeedback({required this.id, required this.agentIds, required this.timestamp, required this.feedbackCount, required this.feedback, required this.summary, required this.options});

  factory AggregatedFeedback.fromJson(Map<String, dynamic> json) {
    return AggregatedFeedback(
      id: json['id'] ?? '',
      agentIds: List<String>.from(json['agentIds'] ?? []),
      timestamp: json['timestamp'] ?? '',
      feedbackCount: json['feedbackCount'] ?? 0,
      feedback: (json['feedback'] as List? ?? []).map((f) => FeedbackItem.fromJson(f)).toList(),
      summary: FeedbackSummary.fromJson(json['summary'] ?? {}),
      options: AggregateOptions.fromJson(json['options'] ?? {}),
    );
  }
}

class FeedbackItem {
  final String? agentId, agentRole, category, priority, message;
  final Map<String, dynamic>? data;

  FeedbackItem({this.agentId, this.agentRole, this.category, this.priority, this.message, this.data});

  factory FeedbackItem.fromJson(Map<String, dynamic> json) {
    return FeedbackItem(agentId: json['agentId'], agentRole: json['agentRole'], category: json['category'], priority: json['priority'], message: json['message'], data: json['data']);
  }
}

class FeedbackSummary {
  final int total;
  final Map<String, int> byPriority, byCategory;

  FeedbackSummary({required this.total, required this.byPriority, required this.byCategory});

  factory FeedbackSummary.fromJson(Map<String, dynamic> json) {
    return FeedbackSummary(total: json['total'] ?? 0, byPriority: Map<String, int>.from(json['byPriority'] ?? {}), byCategory: Map<String, int>.from(json['byCategory'] ?? {}));
  }
}
