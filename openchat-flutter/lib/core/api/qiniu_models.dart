import 'dart:typed_data';

class BucketObject {
  final String key;
  final int size;
  final int lastModified; // epoch milliseconds
  final String eTag;

  BucketObject({
    required this.key,
    required this.size,
    required this.lastModified,
    required this.eTag,
  });
}

class ListResponse {
  final bool isTruncated;
  final List<BucketObject> contents;
  final List<String> commonPrefixes; // for delimiters

  ListResponse({
    this.isTruncated = false,
    this.contents = const [],
    this.commonPrefixes = const [],
  });
}

class QiniuConfig {
  final String accessKey;
  final String secretKey;
  final String bucket;
  final String endpoint;
  final String region;

  QiniuConfig({
    required this.accessKey,
    required this.secretKey,
    required this.bucket,
    required this.endpoint,
    required this.region,
  });

  factory QiniuConfig.fromJson(Map<String, dynamic> json) {
    return QiniuConfig(
      accessKey: json['accessKey'] as String? ?? '',
      secretKey: json['secretKey'] as String? ?? '',
      bucket: json['bucket'] as String? ?? '',
      endpoint: json['endpoint'] as String? ?? '',
      region: json['region'] as String? ?? '',
    );
  }
}

class GlobalStyle {
  final Map<String, dynamic> _style = {};

  double spacing(String key, [double fallback = 12]) =>
      (_style['spacing'] as Map?)?[key] as double? ?? fallback;

  double radius(String key, [double fallback = 12]) =>
      (_style['radius'] as Map?)?[key] as double? ?? fallback;

  void update(Map<String, dynamic> style) {
    _style.addAll(style);
  }
}
