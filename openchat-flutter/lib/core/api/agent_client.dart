import 'package:openchat_flutter/core/api/base_client.dart';
import 'package:openchat_flutter/core/models/agent_model.dart';

class AgentClient extends BaseClient {
  AgentClient({
    required super.baseUrl,
    super.token,
  });

  Future<Agent> createAgent({
    required String role,
    String? name,
    String? task,
    List<String>? capabilities,
  }) async {
    final response = await dio.post(
      '$baseUrl/api/v1/agents',
      data: {
        'role': role,
        'name': name,
        'task': task,
        'capabilities': capabilities,
      },
    );
    return Agent.fromJson(response.data);
  }

  Future<List<Agent>> getAgents({String? status}) async {
    final response = await dio.get(
      '$baseUrl/api/v1/agents',
      queryParameters: status != null ? {'status': status} : null,
    );
    final List<dynamic> data = response.data['agents'];
    return data.map((json) => Agent.fromJson(json)).toList();
  }

  Future<Agent> getAgentDetails(String id) async {
    final response = await dio.get('$baseUrl/api/v1/agents/$id');
    return Agent.fromJson(response.data);
  }

  Future<AgentFeedback> getAgentFeedback(String id) async {
    final response = await dio.get('$baseUrl/api/v1/agents/$id/feedback');
    return AgentFeedback.fromJson(response.data);
  }

  Future<void> terminateAgent(String id) async {
    await dio.delete('$baseUrl/api/v1/agents/$id');
  }
}