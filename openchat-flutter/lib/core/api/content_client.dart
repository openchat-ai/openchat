import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'base_client.dart';

/// 内容类型枚举
enum ContentType {
  code,
  file,
  image,
  audio,
  video,
  text,
  json,
}

/// 内容项
class ContentItem {
  final String id;
  final ContentType type;
  final String? text;
  final String? filePath;
  final Uint8List? data;
  final Map<String, dynamic>? metadata;
  final String? checksum;
  final int size;
  final DateTime timestamp;

  ContentItem({
    required this.id,
    required this.type,
    this.text,
    this.filePath,
    this.data,
    this.metadata,
    this.checksum,
    required this.size,
    required this.timestamp,
  });

  factory ContentItem.fromJson(Map<String, dynamic> json) {
    return ContentItem(
      id: json['id'],
      type: ContentType.values.firstWhere(
        (e) => e.name == json['type'],
        orElse: () => ContentType.file,
      ),
      text: json['text'],
      filePath: json['filePath'],
      data: json['data'] != null ? base64Decode(json['data']) : null,
      metadata: json['metadata'],
      checksum: json['checksum'],
      size: json['size'] ?? 0,
      timestamp: DateTime.parse(json['timestamp']),
    );
  }
}

/// 内容管理客户端
class ContentClient extends BaseClient {
  ContentClient(super.baseUrl);

  /// 存储内容
  Future<ContentItem> storeContent({
    required ContentType type,
    String? text,
    Uint8List? data,
    Map<String, dynamic>? metadata,
  }) async {
    final response = await post(
      '/api/v1/contents',
      body: jsonEncode({
        'type': type.name,
        'text': text,
        'data': data != null ? base64Encode(data) : null,
        'metadata': metadata,
      }),
    );

    return ContentItem.fromJson(response.data);
  }

  /// 获取内容
  Future<ContentItem> getContent(String contentId) async {
    final response = await get('/api/v1/contents/$contentId');
    return ContentItem.fromJson(response.data);
  }

  /// 获取内容元数据
  Future<ContentItem> getContentMeta(String contentId) async {
    final response = await get('/api/v1/contents/$contentId/meta');
    return ContentItem.fromJson(response.data);
  }

  /// 删除内容
  Future<bool> deleteContent(String contentId) async {
    final response = await delete('/api/v1/contents/$contentId');
    return response.data['success'] ?? false;
  }

  /// 搜索内容
  Future<List<ContentItem>> searchContents({
    String? query,
    ContentType? type,
    int limit = 20,
    int offset = 0,
  }) async {
    final queryParams = {
      if (query != null) 'query': query,
      if (type != null) 'type': type.name,
      'limit': limit.toString(),
      'offset': offset.toString(),
    };

    final response = await get('/api/v1/contents', queryParams: queryParams);
    return (response.data['items'] as List)
        .map((e) => ContentItem.fromJson(e))
        .toList();
  }

  /// 验证内容完整性
  Future<bool> verifyContent(String contentId) async {
    final response = await post('/api/v1/contents/$contentId/verify');
    return response.data['valid'] ?? false;
  }
}