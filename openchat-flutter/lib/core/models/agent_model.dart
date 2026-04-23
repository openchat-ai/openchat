import 'package:json_annotation/json_annotation.dart';

part 'agent_model.g.dart';

enum AgentStatus {
  @JsonValue('INITIALIZING')
  initializing,
  @JsonValue('RUNNING')
  running,
  @JsonValue('COMPLETED')
  completed,
  @JsonValue('FAILED')
  failed,
  @JsonValue('TERMINATED')
  terminated,
}

@freezed
class Agent with _$Agent {
  const factory Agent({
    required String id,
    required String role,
    required String name,
    required AgentStatus status,
    required DateTime createdAt,
    @Default([]) List<String> capabilities,
    String? task,
  }) = _Agent;

  factory Agent.fromJson(Map<String, dynamic> json) => _$AgentFromJson(json);
}

@freezed
class AgentFeedback with _$AgentFeedback {
  const factory AgentFeedback({
    required String agentId,
    required List<Finding> findings,
    required String summary,
    @Default(0.0) double performanceScore,
  }) = _AgentFeedback;

  factory AgentFeedback.fromJson(Map<String, dynamic> json) => _$AgentFeedbackFromJson(json);
}

@freezed
class Finding with _$Finding {
  const factory Finding({
    required String type, // CRITICAL, HIGH, MEDIUM, LOW
    required String description,
    required String location,
    required String remediation,
    required double confidence,
  }) = _Finding;

  factory Finding.fromJson(Map<String, dynamic> json) => _$FindingFromJson(json);
}
