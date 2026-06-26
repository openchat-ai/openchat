import 'package:dio/dio.dart';
import 'base_client.dart';

/// ===== experiments_client.dart =====
///
/// Bridge 端 /api/v1/experiments* + /agent/chat + /projects 的 Dio 客户端
/// Plan/Agent 页面用

class ExperimentInfo {
  final String id;
  final String name;
  final String category;
  final String status;
  final String? intelligenceLevel;
  final List<String> deps;
  final String description;

  ExperimentInfo({
    required this.id,
    required this.name,
    required this.category,
    required this.status,
    this.intelligenceLevel,
    required this.deps,
    required this.description,
  });

  factory ExperimentInfo.fromJson(Map<String, dynamic> json) => ExperimentInfo(
    id: json['id']?.toString() ?? '',
    name: json['name']?.toString() ?? '',
    category: json['category']?.toString() ?? '',
    status: json['status']?.toString() ?? '',
    intelligenceLevel: json['intelligenceLevel']?.toString(),
    deps: (json['deps'] as List?)?.map((e) => e.toString()).toList() ?? [],
    description: json['description']?.toString() ?? '',
  );
}

class ExperimentsClient {
  final Dio _dio;
  final String baseUrl;

  ExperimentsClient({required this.baseUrl, BaseClient? shared})
      : _dio = shared?.dio ?? Dio(BaseOptions(
              baseUrl: baseUrl,
              connectTimeout: const Duration(seconds: 10),
              receiveTimeout: const Duration(seconds: 60),
              headers: {'Content-Type': 'application/json'},
            ));

  Future<List<ExperimentInfo>> list() async {
    final r = await _dio.get('/api/v1/experiments');
    final items = (r.data['experiments'] as List?) ?? [];
    return items.map((e) => ExperimentInfo.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<Map<String, dynamic>> run(String id, {Map<String, dynamic>? inputs, Map<String, dynamic>? deps}) async {
    final r = await _dio.post('/api/v1/experiments/$id/run', data: {'inputs': inputs ?? {}, 'deps': deps ?? {}});
    return Map<String, dynamic>.from(r.data as Map);
  }

  Future<String> agentChat(String text, {String chatId = 'default', String? role, List<String>? tools}) async {
    final body = <String, dynamic>{'text': text, 'chatId': chatId};
    if (role != null) body['role'] = role;
    if (tools != null) body['tools'] = tools;
    final r = await _dio.post('/api/v1/agent/chat', data: body);
    return r.data['response']?.toString() ?? '';
  }

  Future<String> projects() async {
    final r = await _dio.get('/api/v1/projects');
    return r.data['answer']?.toString() ?? '';
  }

  Future<String> status() async {
    final r = await _dio.get('/api/v1/status');
    final d = r.data as Map? ?? {};
    final uptime = d['uptime'] ?? 0;
    final provider = d['provider'] ?? 'none';
    final model = d['model'] ?? 'none';
    return 'bridge status:\n  uptime:    ${uptime}s\n  provider:  $provider\n  model:     $model';
  }
}
