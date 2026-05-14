import 'dart:convert';
import 'dart:typed_data';
import 'base_client.dart';

enum ContentType {
  code,
  file,
  image,
  audio,
  video,
  text,
  json,
}

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

class ContentClient extends BaseClient {
  ContentClient({required super.baseUrl, super.token});

  Future<ContentItem> storeContent({
    required ContentType type,
    String? text,
    Uint8List? data,
    Map<String, dynamic>? metadata,
  }) async {
    final response = await dio.post(
      '$baseUrl/api/v1/contents',
      data: jsonEncode({
        'type': type.name,
        'text': text,
        'data': data != null ? base64Encode(data) : null,
        'metadata': metadata,
      }),
    );

    return ContentItem.fromJson(response.data);
  }

  Future<ContentItem> getContent(String contentId) async {
    final response = await dio.get('$baseUrl/api/v1/contents/$contentId');
    return ContentItem.fromJson(response.data);
  }

  Future<ContentItem> getContentMeta(String contentId) async {
    final response = await dio.get('$baseUrl/api/v1/contents/$contentId/meta');
    return ContentItem.fromJson(response.data);
  }

  Future<bool> deleteContent(String contentId) async {
    final response = await dio.delete('$baseUrl/api/v1/contents/$contentId');
    return response.data['success'] ?? false;
  }

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

    final response = await dio.get('$baseUrl/api/v1/contents', queryParameters: queryParams);
    return (response.data['items'] as List)
        .map((e) => ContentItem.fromJson(e))
        .toList();
  }

  Future<bool> verifyContent(String contentId) async {
    final response = await dio.post('$baseUrl/api/v1/contents/$contentId/verify');
    return response.data['valid'] ?? false;
  }
}
