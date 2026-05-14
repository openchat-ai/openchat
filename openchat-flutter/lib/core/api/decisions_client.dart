import 'package:openchat_flutter/core/api/base_client.dart';

class DecisionsClient extends BaseClient {
  DecisionsClient({required super.baseUrl, super.token});

  Future<Decision> createDecision({required String type, required List<String> feedbackIds, String? reasoning, Map<String, dynamic>? metadata}) async {
    final response = await dio.post('$baseUrl/api/v1/decisions', data: {'type': type, 'feedbackIds': feedbackIds, 'reasoning': reasoning, 'metadata': metadata});
    return Decision.fromJson(response.data);
  }

  Future<DecisionList> getDecisions({String? status, String? type, int limit = 50}) async {
    final response = await dio.get('$baseUrl/api/v1/decisions', queryParameters: {'status': status, 'type': type, 'limit': limit});
    return DecisionList.fromJson(response.data);
  }

  Future<Decision> getDecision(String id) async {
    final response = await dio.get('$baseUrl/api/v1/decisions/$id');
    return Decision.fromJson(response.data);
  }

  Future<Decision> updateDecision(String id, {String? status, String? executedAt}) async {
    final response = await dio.patch('$baseUrl/api/v1/decisions/$id', data: {'status': status, 'executedAt': executedAt});
    return Decision.fromJson(response.data);
  }
}

class Decision {
  final String id, type, reasoning, status, createdAt;
  final List<String> feedbackIds;
  final Map<String, dynamic> metadata;
  final String? executedAt;

  Decision({required this.id, required this.type, required this.feedbackIds, required this.reasoning, required this.metadata, required this.status, required this.createdAt, this.executedAt});

  factory Decision.fromJson(Map<String, dynamic> json) {
    return Decision(
      id: json['id'] ?? '', type: json['type'] ?? '', feedbackIds: List<String>.from(json['feedbackIds'] ?? []),
      reasoning: json['reasoning'] ?? '', metadata: Map<String, dynamic>.from(json['metadata'] ?? {}),
      status: json['status'] ?? '', createdAt: json['createdAt'] ?? '', executedAt: json['executedAt'],
    );
  }
}

class DecisionList {
  final List<Decision> decisions;
  final int total;

  DecisionList({required this.decisions, required this.total});

  factory DecisionList.fromJson(Map<String, dynamic> json) {
    return DecisionList(decisions: (json['decisions'] as List? ?? []).map((d) => Decision.fromJson(d)).toList(), total: json['total'] ?? 0);
  }
}
