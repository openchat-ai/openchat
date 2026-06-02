import 'dart:convert';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'qiniu_models.dart';

/// S3 V4 presigned URL signer for Qiniu S3 compatibility.
/// Supports GET/PUT/DELETE with UNSIGNED-PAYLOAD.
class QiniuSigner {
  static const String _service = 's3';

  /// Generate presigned URL for S3 operations.
  /// - GET: download (default)
  /// - PUT: upload
  /// - DELETE: delete object
  /// - prefix parameter: for LIST operations
  static String presignedUrl(QiniuConfig config, String key,
      {String? prefix, int expires = 300, String method = 'GET'}) {
    final now = DateTime.now().toUtc();
    final amzDate = '${_fmtDate(now)}T${_fmtTime(now)}Z';
    final dateStamp = _fmtDate(now);

    final params = <String, String>{
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': '${config.accessKey}/$dateStamp/${config.region}/$_service/aws4_request',
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': expires.toString(),
      'X-Amz-SignedHeaders': 'host',
    };

    String canonicalUri;
    if (prefix != null) {
      canonicalUri = '/';
      params['prefix'] = prefix;
    } else {
      // Virtual-hosted style
      canonicalUri = '/$key';
    }

    final sortedKeys = params.keys.toList()..sort();
    final canonicalQueryString = sortedKeys
        .map((k) => '${Uri.encodeQueryComponent(k)}=${Uri.encodeQueryComponent(params[k]!)}')
        .join('&');

    final canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      'host:${config.endpoint}',
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    final credentialScope = '$dateStamp/${config.region}/$_service/aws4_request';
    final stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256.convert(utf8.encode(canonicalRequest)).toString(),
    ].join('\n');

    // AWS V4 signing key chain
    final kDate = Hmac(sha256, utf8.encode('AWS4${config.secretKey}'))
        .convert(utf8.encode(dateStamp))
        .bytes;
    final kRegion = Hmac(sha256, kDate)
        .convert(utf8.encode(config.region))
        .bytes;
    final kService = Hmac(sha256, kRegion)
        .convert(utf8.encode(_service))
        .bytes;
    final kSigning = Hmac(sha256, kService)
        .convert(utf8.encode('aws4_request'))
        .bytes;
    final signature = Hmac(sha256, kSigning)
        .convert(utf8.encode(stringToSign))
        .bytes
        .map((b) => b.toRadixString(16).padLeft(2, '0'))
        .join();

    return 'https://${config.endpoint}$canonicalUri?$canonicalQueryString&X-Amz-Signature=$signature';
  }

  /// Upload token for Qiniu form upload.
  static String uploadToken(QiniuConfig config, String key) {
    final deadline = (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 3600;
    final policy = jsonEncode({'scope': '${config.bucket}:$key', 'deadline': deadline});
    final encoded = _base64Url(utf8.encode(policy));
    final hmacSha1 = Hmac(sha1, utf8.encode(config.secretKey))
        .convert(utf8.encode(encoded))
        .bytes;
    return '${config.accessKey}:${_base64Url(hmacSha1)}:$encoded';
  }

  static String _base64Url(List<int> bytes) =>
      base64.encode(bytes).replaceAll('+', '-').replaceAll('/', '_');

  static String _fmtDate(DateTime d) =>
      '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';

  static String _fmtTime(DateTime d) =>
      '${d.hour.toString().padLeft(2, '0')}${d.minute.toString().padLeft(2, '0')}${d.second.toString().padLeft(2, '0')}';
}
```