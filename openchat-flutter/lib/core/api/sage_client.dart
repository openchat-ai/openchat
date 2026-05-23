import 'package:openchat_flutter/core/api/base_client.dart';
import 'package:openchat_flutter/core/models/sage_model.dart';

class SageClient extends BaseClient {
  SageClient({
    required super.baseUrl,
    super.token,
  });

  /// GET /api/v1/sage/:residentId — 获取师徒对话记录
  Future<List<SageRecord>> getConversation(int residentId) async {
    final response = await dio.get('$baseUrl/api/v1/sage/$residentId');
    final List<dynamic> data = response.data['records'];
    return data.map((json) => SageRecord.fromJson(json as Map<String, dynamic>)).toList();
  }

  /// POST /api/v1/sage/:residentId/answer — 回答提问
  Future<SageRecord> answer(int residentId, String recordId, String content) async {
    final response = await dio.post(
      '$baseUrl/api/v1/sage/$residentId/answer',
      data: {
        'recordId': recordId,
        'content': content,
      },
    );
    return SageRecord.fromJson(response.data['record']);
  }

  /// POST /api/v1/sage/:residentId/guide — 主动点拨
  Future<SageRecord> guide(int residentId, String content, String type) async {
    final response = await dio.post(
      '$baseUrl/api/v1/sage/$residentId/guide',
      data: {
        'content': content,
        'type': type,
      },
    );
    return SageRecord.fromJson(response.data['record']);
  }
}
