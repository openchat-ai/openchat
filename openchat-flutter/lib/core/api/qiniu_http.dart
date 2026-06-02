import 'dart:async';
import 'dart:typed_data';
import 'package:http/http.dart' as http;

/// HTTP wrapper with auth headers, retry, and timeout.
class QiniuHttpClient {
  final http.Client _client = http.Client();
  static const int _timeoutSeconds = 8;
  static const int _retryCount = 2;

  Future<http.Response> get(Uri uri, {Map<String, String>? headers}) async {
    for (int attempt = 0; attempt <= _retryCount; attempt++) {
      try {
        final resp = await _client
            .get(uri, headers: headers ?? {'x-amz-content-sha256': 'UNSIGNED-PAYLOAD'})
            .timeout(const Duration(seconds: _timeoutSeconds));
        if (resp.statusCode == 200) return resp;
        throw Exception('GET ${uri.path}: HTTP ${resp.statusCode}');
      } catch (e) {
        if (attempt == _retryCount) rethrow;
        await Future.delayed(Duration(seconds: 1 << attempt));
      }
    }
    throw Exception('GET retry failed');
  }

  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    for (int attempt = 0; attempt <= _retryCount; attempt++) {
      try {
        final resp = await _client.send(request).timeout(const Duration(seconds: 15));
        return resp;
      } catch (e) {
        if (attempt == _retryCount) rethrow;
        await Future.delayed(Duration(seconds: 1 << attempt));
      }
    }
    throw Exception('POST retry failed');
  }

  Future<http.Response> put(Uri uri, {required Map<String, String> headers, required dynamic body}) async {
    final resp = await _client
        .put(uri, headers: headers, body: body)
        .timeout(const Duration(seconds: 10));
    if (resp.statusCode != 200) {
      throw Exception('PUT ${uri.path}: HTTP ${resp.statusCode}');
    }
    return resp;
  }

  Future<http.Response> delete(Uri uri) async {
    final req = http.Request('DELETE', uri);
    final streamed = await _client.send(req).timeout(const Duration(seconds: 10));
    final resp = await http.Response.fromStream(streamed);
    if (resp.statusCode != 204 && resp.statusCode != 200) {
      throw Exception('DELETE ${uri.path}: HTTP ${resp.statusCode}');
    }
    return resp;
  }

  void close() => _client.close();
}
