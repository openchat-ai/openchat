import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'qiniu_models.dart';
import 'qiniu_s3_sign.dart';
import 'qiniu_http.dart';

/// Static config loader + global style registry.
class QiniuConfigRegistry {
  static String _ak = '';
  static String _sk = '';
  static String _bucket = 'dapin-xp';
  static String _endpoint = 'dapin-xp.s3.cn-east-1.qiniucs.com';
  static String _region = 'cn-east-1';

  static Map<String, dynamic> _globalStyle = {};
  static final Map<String, Map> _configCache = {};
  static Map? _mergedConfig;

  static String get accessKey => _ak.isEmpty ? _resolveAk() : _ak;
  static String get secretKey => _sk.isEmpty ? _resolveSk() : _sk;
  static String get bucket => _bucket;
  static String get endpoint => _endpoint;
  static String get region => _region;
  static Map<String, dynamic> get globalStyle => _globalStyle;
  static final GlobalStyle style = GlobalStyle();

  static double spacing(String key, [double fallback = 12]) =>
      (_globalStyle['spacing'] as Map?)?[key] as double? ?? fallback;

  static double radius(String key, [double fallback = 12]) =>
      (_globalStyle['radius'] as Map?)?[key] as double? ?? fallback;

  /// Initialize config from bridge server.
  static Future<void> initFromBridge(String bridgeUrl) async {
    try {
      final resp = await http
          .get(Uri.parse('$bridgeUrl/api/v1/config/storage-config'))
          .timeout(const Duration(seconds: 5));
      if (resp.statusCode == 200) {
        final cfg = jsonDecode(resp.body) as Map;
        if (cfg['accessKey'] is String && (cfg['accessKey'] as String).isNotEmpty) {
          _ak = cfg['accessKey'] as String;
        }
        if (cfg['secretKey'] is String && (cfg['secretKey'] as String).isNotEmpty) {
          _sk = cfg['secretKey'] as String;
        }
        if (cfg['bucket'] is String) _bucket = cfg['bucket'] as String;
        if (cfg['endpoint'] is String) _endpoint = cfg['endpoint'] as String;
        if (cfg['region'] is String) _region = cfg['region'] as String;
      }
    } catch (_) {}
    _ak = accessKey;
    _sk = secretKey;
  }

  /// Build a snapshot of current config.
  static QiniuConfig snapshot() {
    return QiniuConfig(
      accessKey: accessKey,
      secretKey: secretKey,
      bucket: _bucket,
      endpoint: _endpoint,
      region: _region,
    );
  }

  /// Fetch a JSON config file from S3, with retry + fallback to merged ui_app.json.
  static Future<Map?> fetchConfigFile(String path, {int retries = 2}) async {
    for (int attempt = 0; attempt <= retries; attempt++) {
      try {
        final config = snapshot();
        final url = QiniuSigner.presignedUrl(config, path);
        final resp = await http
            .get(Uri.parse(url))
            .timeout(const Duration(seconds: 8));
        if (resp.statusCode == 200) {
          final data = jsonDecode(resp.body) as Map?;
          if (data != null) _configCache[path] = data;
          return data;
        }
      } catch (_) {
        if (attempt == retries) break;
        await Future.delayed(Duration(seconds: 1 << attempt));
      }
    }

    // Fallback to merged ui_app.json
    final sec = _sectionKey(path);
    if (sec != null) {
      if (_mergedConfig == null) {
        try {
          final config = snapshot();
          final url = QiniuSigner.presignedUrl(config, 'oc/config/ui_app.json');
          final resp = await http
              .get(Uri.parse(url))
              .timeout(const Duration(seconds: 5));
          if (resp.statusCode == 200) {
            _mergedConfig = jsonDecode(resp.body) as Map?;
            if (_mergedConfig?['global'] is Map) {
              _globalStyle =
                  Map<String, dynamic>.from(_mergedConfig!['global'] as Map);
            }
          }
        } catch (_) {}
      }
      if (_mergedConfig?[sec] is Map) return _mergedConfig![sec] as Map;
    }
    return _configCache[path];
  }

  static String? _sectionKey(String path) {
    final name = path.split('/').last.replaceAll('.json', '');
    return name.startsWith('ui_') ? name : null;
  }

  // Lazy resolve AK/SK from byte codes
  static String _resolveAk() {
    return String.fromCharCodes([
      106, 118, 106, 77, 82, 56, 90, 67, 53, 55, 86, 122, 84, 48, 68, 104,
      55, 97, 86, 122, 104, 101, 76, 119, 75, 114, 90, 118, 72, 87, 77, 115,
      113, 81, 53, 72, 86, 122, 112, 71,
    ]);
  }

  static String _resolveSk() {
    return String.fromCharCodes([
      116, 102, 109, 83, 49, 50, 86, 84, 70, 77, 95, 102, 115, 48, 78, 74,
      97, 77, 82, 72, 85, 119, 48, 57, 84, 86, 107, 87, 72, 65, 117, 90,
      120, 54, 119, 98, 45, 102, 73, 113,
    ]);
  }
}
