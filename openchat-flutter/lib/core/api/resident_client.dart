import 'package:openchat_flutter/core/api/base_client.dart';
import 'package:openchat_flutter/core/models/resident_model.dart';

class ResidentClient extends BaseClient {
  ResidentClient({
    required super.baseUrl,
    super.token,
  });

  /// POST /api/v1/residents — 出生
  Future<Resident> createResident({String? name, int? parentId}) async {
    final response = await dio.post(
      '$baseUrl/api/v1/residents',
      data: {
        if (name != null) 'name': name,
        if (parentId != null) 'parentId': parentId,
      },
    );
    return Resident.fromJson(response.data);
  }

  /// GET /api/v1/residents — 全体名单
  Future<List<Resident>> getResidents({String? status}) async {
    final response = await dio.get(
      '$baseUrl/api/v1/residents',
      queryParameters: status != null ? {'status': status} : null,
    );
    final List<dynamic> data = response.data['residents'];
    return data.map((json) => Resident.fromJson(json)).toList();
  }

  /// GET /api/v1/residents/:id — 居民档案（含完整活动履历）
  Future<Resident> getResidentDetail(int id) async {
    final response = await dio.get('$baseUrl/api/v1/residents/$id');
    return Resident.fromJson(response.data);
  }

  /// GET /api/v1/residents/:id/children — 查子孙列表
  Future<List<ChildSummary>> getChildren(int id) async {
    final response = await dio.get('$baseUrl/api/v1/residents/$id/children');
    final List<dynamic> data = response.data['children'];
    return data.map((json) => ChildSummary.fromJson(json)).toList();
  }

  /// DELETE /api/v1/residents/:id — 注销
  Future<void> deleteResident(int id) async {
    await dio.delete('$baseUrl/api/v1/residents/$id');
  }

  /// GET /api/v1/community/feed — 社区动态流
  Future<List<FeedItem>> getCommunityFeed({int limit = 20}) async {
    final response = await dio.get(
      '$baseUrl/api/v1/community/feed',
      queryParameters: {'limit': limit},
    );
    final List<dynamic> data = response.data['feed'];
    return data.map((json) => FeedItem.fromJson(json)).toList();
  }
}
