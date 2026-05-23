// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'agent_model.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$AgentImpl _$$AgentImplFromJson(Map<String, dynamic> json) => _$AgentImpl(
  id: json['id'] as String,
  role: json['role'] as String,
  name: json['name'] as String,
  status: $enumDecode(_$AgentStatusEnumMap, json['status']),
  createdAt: DateTime.parse(json['createdAt'] as String),
  capabilities:
      (json['capabilities'] as List<dynamic>?)
          ?.map((e) => e as String)
          .toList() ??
      const [],
  task: json['task'] as String?,
);

Map<String, dynamic> _$$AgentImplToJson(_$AgentImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'role': instance.role,
      'name': instance.name,
      'status': _$AgentStatusEnumMap[instance.status]!,
      'createdAt': instance.createdAt.toIso8601String(),
      'capabilities': instance.capabilities,
      'task': instance.task,
    };

const _$AgentStatusEnumMap = {
  AgentStatus.initializing: 'INITIALIZING',
  AgentStatus.running: 'RUNNING',
  AgentStatus.completed: 'COMPLETED',
  AgentStatus.failed: 'FAILED',
  AgentStatus.terminated: 'TERMINATED',
};

_$AgentFeedbackImpl _$$AgentFeedbackImplFromJson(Map<String, dynamic> json) =>
    _$AgentFeedbackImpl(
      agentId: json['agentId'] as String,
      findings: (json['findings'] as List<dynamic>)
          .map((e) => Finding.fromJson(e as Map<String, dynamic>))
          .toList(),
      summary: json['summary'] as String,
      performanceScore: (json['performanceScore'] as num?)?.toDouble() ?? 0.0,
    );

Map<String, dynamic> _$$AgentFeedbackImplToJson(_$AgentFeedbackImpl instance) =>
    <String, dynamic>{
      'agentId': instance.agentId,
      'findings': instance.findings,
      'summary': instance.summary,
      'performanceScore': instance.performanceScore,
    };

_$FindingImpl _$$FindingImplFromJson(Map<String, dynamic> json) =>
    _$FindingImpl(
      type: json['type'] as String,
      description: json['description'] as String,
      location: json['location'] as String,
      remediation: json['remediation'] as String,
      confidence: (json['confidence'] as num).toDouble(),
    );

Map<String, dynamic> _$$FindingImplToJson(_$FindingImpl instance) =>
    <String, dynamic>{
      'type': instance.type,
      'description': instance.description,
      'location': instance.location,
      'remediation': instance.remediation,
      'confidence': instance.confidence,
    };
