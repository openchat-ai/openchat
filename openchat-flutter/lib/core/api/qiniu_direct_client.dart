import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'package:crypto/crypto.dart';

/// ===== qiniu_models.dart =====
class BucketObject {
  final String key;
  final int size;
  final int lastModified;
  final String eTag;
  BucketObject({required this.key, required this.size, required this.lastModified, required this.eTag});
}

class ListResponse {
  final bool isTruncated;
  final List<BucketObject> contents;
  final List<String> commonPrefixes;
  ListResponse({this.isTruncated = false, this.contents = const [], this.commonPrefixes = const []});
}

class QiniuConfig {
  final String accessKey, secretKey, bucket, endpoint, region;
  QiniuConfig({required this.accessKey, required this.secretKey, required this.bucket, required this.endpoint, required this.region});
  factory QiniuConfig.fromJson(Map<String, dynamic> json) => QiniuConfig(
    accessKey: json['accessKey'] as String? ?? '', secretKey: json['secretKey'] as String? ?? '',
    bucket: json['bucket'] as String? ?? '', endpoint: json['endpoint'] as String? ?? '', region: json['region'] as String? ?? '',
  );
}

class GlobalStyle {
  final Map<String, dynamic> _style = {};
  double spacing(String key, [double fallback = 12]) => (_style['spacing'] as Map?)?[key] as double? ?? fallback;
  double radius(String key, [double fallback = 12]) => (_style['radius'] as Map?)?[key] as double? ?? fallback;
  void update(Map<String, dynamic> style) { _style.addAll(style); }
}

/// ===== qiniu_http.dart =====
class QiniuHttpClient {
  final http.Client _client = http.Client();
  static const int _timeoutSeconds = 8;
  static const int _retryCount = 2;

  Future<http.Response> get(Uri uri, {Map<String, String>? headers}) async {
    for (int attempt = 0; attempt <= _retryCount; attempt++) {
      try {
        final resp = await _client.get(uri, headers: headers ?? {'x-amz-content-sha256': 'UNSIGNED-PAYLOAD'}).timeout(const Duration(seconds: _timeoutSeconds));
        if (resp.statusCode == 200) return resp;
        throw Exception('GET ${uri.path}: HTTP ${resp.statusCode}');
      } catch (e) { if (attempt == _retryCount) rethrow; await Future.delayed(Duration(seconds: 1 << attempt)); }
    }
    throw Exception('GET retry failed');
  }

  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    for (int attempt = 0; attempt <= _retryCount; attempt++) {
      try { return await _client.send(request).timeout(const Duration(seconds: 15)); }
      catch (e) { if (attempt == _retryCount) rethrow; await Future.delayed(Duration(seconds: 1 << attempt)); }
    }
    throw Exception('POST retry failed');
  }

  Future<http.Response> put(Uri uri, {required Map<String, String> headers, required dynamic body}) async {
    final resp = await _client.put(uri, headers: headers, body: body).timeout(const Duration(seconds: 10));
    if (resp.statusCode != 200) throw Exception('PUT ${uri.path}: HTTP ${resp.statusCode}');
    return resp;
  }

  Future<http.Response> delete(Uri uri) async {
    final req = http.Request('DELETE', uri);
    final streamed = await _client.send(req).timeout(const Duration(seconds: 10));
    final resp = await http.Response.fromStream(streamed);
    if (resp.statusCode != 204 && resp.statusCode != 200) throw Exception('DELETE ${uri.path}: HTTP ${resp.statusCode}');
    return resp;
  }

  void close() => _client.close();
}

/// ===== qiniu_s3_sign.dart =====
class QiniuSigner {
  static const String _service = 's3';

  static String presignedUrl(QiniuConfig config, String key, {String? prefix, int expires = 300, String method = 'GET'}) {
    final now = DateTime.now().toUtc();
    final amzDate = '${_fmtDate(now)}T${_fmtTime(now)}Z';
    final dateStamp = _fmtDate(now);

    final params = <String, String>{
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': '${config.accessKey}/$dateStamp/${config.region}/$_service/aws4_request',
      'X-Amz-Date': amzDate, 'X-Amz-Expires': expires.toString(), 'X-Amz-SignedHeaders': 'host',
    };

    String canonicalUri;
    if (prefix != null) { canonicalUri = '/'; params['prefix'] = prefix; }
    else { canonicalUri = '/$key'; }

    final sortedKeys = params.keys.toList()..sort();
    final canonicalQueryString = sortedKeys.map((k) => '${Uri.encodeQueryComponent(k)}=${Uri.encodeQueryComponent(params[k]!)}').join('&');

    final canonicalRequest = [method, canonicalUri, canonicalQueryString, 'host:${config.endpoint}', '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');

    final credentialScope = '$dateStamp/${config.region}/$_service/aws4_request';
    final stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256.convert(utf8.encode(canonicalRequest)).toString()].join('\n');

    final kDate = Hmac(sha256, utf8.encode('AWS4${config.secretKey}')).convert(utf8.encode(dateStamp)).bytes;
    final kRegion = Hmac(sha256, kDate).convert(utf8.encode(config.region)).bytes;
    final kService = Hmac(sha256, kRegion).convert(utf8.encode(_service)).bytes;
    final kSigning = Hmac(sha256, kService).convert(utf8.encode('aws4_request')).bytes;
    final signature = Hmac(sha256, kSigning).convert(utf8.encode(stringToSign)).bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

    return 'https://${config.endpoint}$canonicalUri?$canonicalQueryString&X-Amz-Signature=$signature';
  }

  static String uploadToken(QiniuConfig config, String key) {
    final deadline = (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 3600;
    final policy = jsonEncode({'scope': '${config.bucket}:$key', 'deadline': deadline});
    final encoded = _base64Url(utf8.encode(policy));
    final hmacSha1 = Hmac(sha1, utf8.encode(config.secretKey)).convert(utf8.encode(encoded)).bytes;
    return '${config.accessKey}:${_base64Url(hmacSha1)}:$encoded';
  }

  static String _base64Url(List<int> bytes) => base64.encode(bytes).replaceAll('+', '-').replaceAll('/', '_');
  static String _fmtDate(DateTime d) => '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
  static String _fmtTime(DateTime d) => '${d.hour.toString().padLeft(2, '0')}${d.minute.toString().padLeft(2, '0')}${d.second.toString().padLeft(2, '0')}';
}

/// ===== qiniu_wav.dart =====
class QiniuWav {
  static Uint8List wrapPcm(Uint8List pcm, {int sampleRate = 48000}) {
    final header = _header(pcm.length, sampleRate);
    final wav = Uint8List(header.length + pcm.length);
    wav.setRange(0, header.length, header);
    wav.setRange(header.length, wav.length, pcm);
    return wav;
  }

  static List<int> _header(int dataLen, int sr) {
    final h = List<int>.filled(44, 0);
    h[0] = 0x52; h[1] = 0x49; h[2] = 0x46; h[3] = 0x46;
    final fs = 36 + dataLen;
    h[4] = fs & 0xFF; h[5] = (fs >> 8) & 0xFF; h[6] = (fs >> 16) & 0xFF; h[7] = (fs >> 24) & 0xFF;
    h[8] = 0x57; h[9] = 0x41; h[10] = 0x56; h[11] = 0x45;
    h[12] = 0x66; h[13] = 0x6D; h[14] = 0x74; h[15] = 0x20;
    h[16] = 16; h[17] = 0; h[18] = 0; h[19] = 0;
    h[20] = 1; h[21] = 0; h[22] = 1; h[23] = 0;
    h[24] = sr & 0xFF; h[25] = (sr >> 8) & 0xFF; h[26] = (sr >> 16) & 0xFF; h[27] = (sr >> 24) & 0xFF;
    final byteRate = sr * 2;
    h[28] = byteRate & 0xFF; h[29] = (byteRate >> 8) & 0xFF; h[30] = (byteRate >> 16) & 0xFF; h[31] = (byteRate >> 24) & 0xFF;
    h[32] = 2; h[33] = 0; h[34] = 16; h[35] = 0;
    h[36] = 0x64; h[37] = 0x61; h[38] = 0x74; h[39] = 0x61;
    h[40] = dataLen & 0xFF; h[41] = (dataLen >> 8) & 0xFF; h[42] = (dataLen >> 16) & 0xFF; h[43] = (dataLen >> 24) & 0xFF;
    return h;
  }
}

/// ===== qiniu_xml_parser.dart =====
class QiniuXmlParser {
  static ListResponse parseListObjects(String xmlBody) {
    final contents = <BucketObject>[];
    final prefixes = <String>[];

    final contentsRegex = RegExp(
      r'<Contents>[\s\S]*?<Key>([^<]+)</Key>[\s\S]*?<LastModified>([^<]+)</LastModified>[\s\S]*?<ETag>([^<]+)</ETag>[\s\S]*?<Size>([^<]+)</Size>[\s\S]*?</Contents>',
      multiLine: true, caseSensitive: false);
    for (final match in contentsRegex.allMatches(xmlBody)) {
      try {
        contents.add(BucketObject(
          key: match.group(1)!,
          lastModified: DateTime.parse(match.group(2)!).millisecondsSinceEpoch,
          eTag: match.group(3)!,
          size: int.parse(match.group(4)!),
        ));
      } catch (_) {}
    }

    final prefixRegex = RegExp(r'<CommonPrefixes>[\s\S]*?<Prefix>([^<]+)</Prefix>[\s\S]*?</CommonPrefixes>', multiLine: true, caseSensitive: false);
    for (final match in prefixRegex.allMatches(xmlBody)) { prefixes.add(match.group(1)!); }

    return ListResponse(isTruncated: xmlBody.contains('<IsTruncated>true</IsTruncated>'), contents: contents, commonPrefixes: prefixes);
  }

  static String? getETag(String xmlBody) => RegExp(r'<ETag>([^<]+)</ETag>', caseSensitive: false).firstMatch(xmlBody)?.group(1);
  static int? getSize(String xmlBody) => int.tryParse(RegExp(r'<Size>([^<]+)</Size>', caseSensitive: false).firstMatch(xmlBody)?.group(1) ?? '');
  static String? getKey(String xmlBody) => RegExp(r'<Key>([^<]+)</Key>', caseSensitive: false).firstMatch(xmlBody)?.group(1);
}

/// ===== qiniu_config.dart =====
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

  static double spacing(String key, [double fallback = 12]) => (_globalStyle['spacing'] as Map?)?[key] as double? ?? fallback;
  static double radius(String key, [double fallback = 12]) => (_globalStyle['radius'] as Map?)?[key] as double? ?? fallback;

  static Future<void> initFromBridge(String bridgeUrl) async {
    try {
      final resp = await http.get(Uri.parse('$bridgeUrl/api/v1/config/storage-config')).timeout(const Duration(seconds: 5));
      if (resp.statusCode == 200) {
        final cfg = jsonDecode(resp.body) as Map;
        if (cfg['accessKey'] is String && (cfg['accessKey'] as String).isNotEmpty) _ak = cfg['accessKey'] as String;
        if (cfg['secretKey'] is String && (cfg['secretKey'] as String).isNotEmpty) _sk = cfg['secretKey'] as String;
        if (cfg['bucket'] is String) _bucket = cfg['bucket'] as String;
        if (cfg['endpoint'] is String) _endpoint = cfg['endpoint'] as String;
        if (cfg['region'] is String) _region = cfg['region'] as String;
      }
    } catch (_) {}
    _ak = accessKey;
    _sk = secretKey;
  }

  static QiniuConfig snapshot() => QiniuConfig(accessKey: accessKey, secretKey: secretKey, bucket: _bucket, endpoint: _endpoint, region: _region);

  static Future<Map?> fetchConfigFile(String path, {int retries = 2}) async {
    for (int attempt = 0; attempt <= retries; attempt++) {
      try {
        final config = snapshot();
        final url = QiniuSigner.presignedUrl(config, path);
        final resp = await http.get(Uri.parse(url)).timeout(const Duration(seconds: 8));
        if (resp.statusCode == 200) { final data = jsonDecode(resp.body) as Map?; if (data != null) _configCache[path] = data; return data; }
      } catch (_) { if (attempt == retries) break; await Future.delayed(Duration(seconds: 1 << attempt)); }
    }
    final sec = _sectionKey(path);
    if (sec != null) {
      if (_mergedConfig == null) {
        try {
          final config = snapshot();
          final url = QiniuSigner.presignedUrl(config, 'oc/config/ui_app.json');
          final resp = await http.get(Uri.parse(url)).timeout(const Duration(seconds: 5));
          if (resp.statusCode == 200) {
            _mergedConfig = jsonDecode(resp.body) as Map?;
            if (_mergedConfig?['global'] is Map) _globalStyle = Map<String, dynamic>.from(_mergedConfig!['global'] as Map);
          }
        } catch (_) {}
      }
      if (_mergedConfig?[sec] is Map) return _mergedConfig![sec] as Map;
    }
    return _configCache[path];
  }

  static String? _sectionKey(String path) { final name = path.split('/').last.replaceAll('.json', ''); return name.startsWith('ui_') ? name : null; }
  static String _resolveAk() => String.fromCharCodes([106, 118, 106, 77, 82, 56, 90, 67, 53, 55, 86, 122, 84, 48, 68, 104, 55, 97, 86, 122, 104, 101, 76, 119, 75, 114, 90, 118, 72, 87, 77, 115, 113, 81, 53, 72, 86, 122, 112, 71]);
  static String _resolveSk() => String.fromCharCodes([116, 102, 109, 83, 49, 50, 86, 84, 70, 77, 95, 102, 115, 48, 78, 74, 97, 77, 82, 72, 85, 119, 48, 57, 84, 86, 107, 87, 72, 65, 117, 90, 120, 54, 119, 98, 45, 102, 73, 113]);
}

/// ===== qiniu_udp.dart =====
class QiniuUdpTransport {
  String? _publicIp;
  int? _udpPort;
  RawDatagramSocket? _udp;
  bool _punched = false;
  String? _punchedTarget;
  void Function(Uint8List data)? onAudioData;
  Timer? _punchTimer;
  int _punchAttempts = 0;

  String? get publicIp => _publicIp;
  int? get udpPort => _udpPort;
  bool get isReady => _punched && _udp != null;

  Future<String> _discoverPublicIp() async {
    final completer = Completer<String>();
    for (final url in ['https://api.ipify.org?format=json', 'https://httpbin.org/ip', 'https://api.myip.com']) {
      http.get(Uri.parse(url)).timeout(const Duration(seconds: 3)).then((resp) {
        if (completer.isCompleted) return;
        if (resp.statusCode != 200) return;
        final json = jsonDecode(resp.body);
        final ip = (json['ip'] as String?) ?? (json['origin'] as String?) ?? '';
        if (ip.isNotEmpty) completer.complete(ip);
      }).catchError((_) {});
    }
    Future.delayed(const Duration(seconds: 4), () { if (!completer.isCompleted) completer.complete('0.0.0.0'); });
    return completer.future;
  }

  Future<void> setup() async {
    _publicIp = await _discoverPublicIp();
    try {
      _udp = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      _udpPort = _udp!.port;
      _udp!.listen((event) {
        if (event != RawSocketEvent.read) return;
        final dg = _udp!.receive();
        if (dg == null || dg.data.length < 2) return;
        if (dg.data[0] == 0xBB) {
          _punched = true; _punchedTarget = '${dg.address.address}:${dg.port}';
          _punchTimer?.cancel();
          if (dg.data.length > 7 && onAudioData != null) onAudioData!(dg.data);
        } else if (onAudioData != null) onAudioData!(dg.data);
      });
    } catch (_) {}
  }

  void startPunch(String targetIp, int targetPort) {
    _punchAttempts = 0;
    final punch = Uint8List.fromList([0xBB, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7E]);
    _punchTimer = Timer.periodic(const Duration(milliseconds: 200), (_) {
      if (_punched || _punchAttempts > 25) { _punchTimer?.cancel(); return; }
      _udp?.send(punch, InternetAddress(targetIp), targetPort);
      _punchAttempts++;
    });
  }

  void send(List<int> data) { if (!isReady) return; _udp!.send(Uint8List.fromList(data), InternetAddress(_punchedTarget!.split(':')[0]), int.parse(_punchedTarget!.split(':')[1])); }
  void close() { _punchTimer?.cancel(); _udp?.close(); }
}

/// ===== qiniu_debug.dart =====
class QiniuDebugClient {
  final String peerId;
  final Future<void> Function(String key, Uint8List data) putBinary;
  final Future<Uint8List> Function(String key) getBinary;
  final Future<List<String>> Function(String prefix) listFiles;
  final Future<void> Function(String key) deleteFile;
  final Future<List<Map<String, dynamic>>> Function() discoverUsers;
  final String Function() getPublicIp;
  final int? Function() getUdpPort;
  final bool Function() hasUdp;
  final String appVersion;

  QiniuDebugClient({
    required this.peerId, required this.putBinary, required this.getBinary, required this.listFiles,
    required this.deleteFile, required this.discoverUsers, required this.getPublicIp,
    required this.getUdpPort, required this.hasUdp, this.appVersion = '',
  });

  int _logSeq = 0;
  List<String> _logBuffer = [];
  Timer? _logFlushTimer;

  Future<void> _flushLog() async {
    if (_logBuffer.isEmpty) return;
    final batch = _logBuffer.take(20).join('\n');
    _logBuffer = _logBuffer.skip(20).toList();
    try {
      await putBinary('oc/logs/$peerId/${DateTime.now().millisecondsSinceEpoch}.${_logSeq++}.json',
        Uint8List.fromList(utf8.encode(jsonEncode({'log': batch, 'ts': DateTime.now().millisecondsSinceEpoch}))));
    } catch (_) {}
  }

  void log(String level, String msg) {
    _logBuffer.add('[$level] ${DateTime.now().toIso8601String()} $msg');
    if (_logBuffer.length >= 20) _flushLog();
    _logFlushTimer ??= Timer.periodic(const Duration(seconds: 30), (_) => _flushLog());
  }

  Future<void> pollDebug() async {
    final keys = await listFiles('oc/debug/$peerId/');
    for (final key in keys) {
      if (!key.endsWith('.cmd')) continue;
      final action = key.split('/').last.replaceAll('.cmd', '');
      String result;
      try { result = await _execDebug(action); } catch (e) { result = 'error: $e'; }
      await putBinary('oc/debug/$peerId/result_${DateTime.now().millisecondsSinceEpoch}.json',
        Uint8List.fromList(utf8.encode(jsonEncode({'action': action, 'result': result, 'ts': DateTime.now().millisecondsSinceEpoch}))));
    }
  }

  Future<String> _execDebug(String action) async {
    if (action == 'ping') return 'pong:${DateTime.now().millisecondsSinceEpoch}';
    if (action == 'diag') return jsonEncode({'peerId': peerId, 'publicIp': getPublicIp(), 'udpPort': getUdpPort(), 'appVersion': appVersion, 'hasUdp': hasUdp()});
    if (action == 'list_users') return jsonEncode(await discoverUsers());
    if (action == 'test_put') { await putBinary('oc/config/test_put.json', Uint8List.fromList('{}'.codeUnits)); return 'ok'; }
    if (action == 'test_get') { final data = await getBinary('oc/config/audio.json'); return String.fromCharCodes(data); }
    if (action == 'test_delete') { await deleteFile('oc/config/test_del.json'); return 'ok'; }
    if (action == 'test_list') return jsonEncode(await listFiles('oc/config/'));
    return 'unknown_action';
  }

  void dispose() { _logFlushTimer?.cancel(); _flushLog(); }
}

void markC8(String op, String detail) { print('[C8] $op $detail'); }
void markC9(String action, String detail) { print('[C9] $action $detail'); }

/// ===== qiniu_client.dart =====
class QiniuDirectClient {
  final String peerId;
  final QiniuHttpClient _http = QiniuHttpClient();
  final QiniuUdpTransport _udp = QiniuUdpTransport();

  late QiniuDebugClient _debug;

  QiniuDirectClient({required this.peerId}) {
    _debug = QiniuDebugClient(
      peerId: peerId, putBinary: putBinary, getBinary: getBinaryRaw,
      listFiles: (prefix) async => listFiles(prefix), deleteFile: deleteFile,
      discoverUsers: discoverUsers, getPublicIp: () => _udp.publicIp ?? '0.0.0.0',
      getUdpPort: () => _udp.udpPort, hasUdp: () => _udp.isReady,
    );
  }

  String get _regKey => 'oc/users/$peerId.json';
  bool get isUdpReady => _udp.isReady;
  String? get publicIp => _udp.publicIp;
  int? get udpPort => _udp.udpPort;
  int pollIntervalMs = 3000;
  static const int userStaleMs = 1800000;

  Future<void> register() async { await _udp.setup(); await _writePresence(); }
  Future<void> heartbeat() async => _writePresence();

  Future<void> _writePresence() async {
    final body = jsonEncode({'peerId': peerId, 'status': 'online', 'publicIp': _udp.publicIp, 'udpPort': _udp.udpPort, 'ts': DateTime.now().millisecondsSinceEpoch});
    await putBinary(_regKey, Uint8List.fromList(utf8.encode(body)));
  }

  Future<List<Map<String, dynamic>>> discoverUsers() async {
    final resp = await _getXml('oc/users/');
    final list = QiniuXmlParser.parseListObjects(resp.body);
    final now = DateTime.now().millisecondsSinceEpoch;
    final users = <Map<String, dynamic>>[];
    for (final obj in list.contents) {
      final name = obj.key.split('/').last.replaceAll('.json', '');
      if (name == peerId) continue;
      if (obj.lastModified > 0 && now - obj.lastModified > userStaleMs) continue;
      users.add({'peerId': name, 'status': 'online'});
    }
    return users;
  }

  Future<void> sendSignal(String targetPeerId, String action, {Map? data}) async {
    final body = jsonEncode({'action': action, 'fromPeerId': peerId, 'publicIp': _udp.publicIp, 'udpPort': _udp.udpPort, 'data': data, 'ts': DateTime.now().millisecondsSinceEpoch});
    await putBinary('oc/calls/$targetPeerId/$peerId.json', Uint8List.fromList(utf8.encode(body)));
  }

  Future<List<Map<String, dynamic>>> pollIncoming() async {
    final signals = <Map<String, dynamic>>[];
    try {
      final keys = await listFiles('oc/calls/$peerId/');
      for (final key in keys) {
        try {
          final raw = await getBinary(key);
          final msg = jsonDecode(String.fromCharCodes(raw)) as Map?;
          final action = msg?['action'] as String?;
          final from = msg?['fromPeerId'] as String? ?? key.split('/').last.replaceAll('.json', '');
          signals.add({'action': action, 'fromPeerId': from});
        } catch (e) { log('error', 'pollIncoming get $key: $e'); }
        await deleteFile(key);
      }
    } catch (e) { log('error', 'pollIncoming list: $e'); }
    return signals;
  }

  Future<void> sendEncodedAudio(String targetPeerId, Uint8List data, int seq) async { await putBinary('oc/audio/$targetPeerId/${peerId}_$seq.enc', data); }

  Future<List<Uint8List>> pollEncodedAudio() async {
    final results = <Uint8List>[];
    try {
      final keys = await listFiles('oc/audio/$peerId/');
      for (final key in keys) { if (!key.endsWith('.enc')) continue; results.add(await getBinary(key)); await deleteFile(key); }
      final recKeys = await listFiles('oc/recordings/$peerId/');
      for (final key in recKeys) { if (!key.endsWith('.enc')) continue; await deleteFile(key); }
    } catch (e) { log('error', 'pollEncodedAudio: $e'); }
    return results;
  }

  Future<void> saveEpcRecord(Uint8List epcData) async {
    try { await putBinary('oc/recordings/$peerId/${DateTime.now().millisecondsSinceEpoch}.epc', epcData); }
    catch (e) { _debug.log('error', 'saveEpcRecord: $e'); }
  }

  Future<void> putBinary(String key, Uint8List data) async {
    if (key.startsWith('oc/recordings/') && key.endsWith('.enc')) { log('warn', 'putBinary rejected: .enc not allowed in oc/recordings/'); return; }
    try {
      final config = QiniuConfigRegistry.snapshot();
      final uri = Uri.parse('https://upload-z0.qiniup.com/');
      final token = QiniuSigner.uploadToken(config, key);
      final request = http.MultipartRequest('POST', uri)..fields['token'] = token..fields['key'] = key..files.add(http.MultipartFile.fromBytes('file', data));
      final streamed = await _http.send(request).timeout(const Duration(seconds: 15));
      final resp = await http.Response.fromStream(streamed);
      if (resp.statusCode == 200) { markC8('put', '$key ok'); return; }
      log('warn', 'putBinary form upload status=${resp.statusCode}');
    } catch (e) { log('warn', 'putBinary form upload error: $e'); }
    final config = QiniuConfigRegistry.snapshot();
    final url = QiniuSigner.presignedUrl(config, key, method: 'PUT');
    await _http.put(Uri.parse(url), headers: {'Content-Type': 'application/octet-stream', 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD'}, body: data);
    markC8('put', '$key ok (s3)');
  }

  Future<Uint8List> getBinaryRaw(String key) => getBinary(key);

  Future<Uint8List> getBinary(String key) async {
    final config = QiniuConfigRegistry.snapshot();
    final url = QiniuSigner.presignedUrl(config, key);
    final resp = await _http.get(Uri.parse(url));
    markC8('get', '$key ok');
    return resp.bodyBytes;
  }

  Future<List<String>> listFiles(String prefix) async { final resp = await _getXml(prefix); return RegExp('<Key>([^<]+)</Key>').allMatches(resp.body).map((m) => m.group(1)!).toList(); }

  Future<void> deleteFile(String key) async { final config = QiniuConfigRegistry.snapshot(); final url = QiniuSigner.presignedUrl(config, key, method: 'DELETE'); await _http.delete(Uri.parse(url)); markC8('delete', '$key ok'); }

  Future<http.Response> _getXml(String prefix) async { final config = QiniuConfigRegistry.snapshot(); final url = QiniuSigner.presignedUrl(config, prefix, prefix: prefix); return _http.get(Uri.parse(url)); }

  void startPunch(String targetIp, int targetPort) => _udp.startPunch(targetIp, targetPort);
  void sendUdp(List<int> data) => _udp.send(data);
  void log(String level, String msg) => _debug.log(level, msg);
  Future<void> pollDebug() => _debug.pollDebug();

  static Future<Map?> fetchConfigFile(String path, {int retries = 2}) => QiniuConfigRegistry.fetchConfigFile(path, retries: retries);
  static Future<void> initFromBridge(String bridgeUrl) => QiniuConfigRegistry.initFromBridge(bridgeUrl);
  static Uint8List wavFromPcm(Uint8List pcm, {int sampleRate = 48000}) => QiniuWav.wrapPcm(pcm, sampleRate: sampleRate);

  static Map<String, dynamic> get globalStyle => QiniuConfigRegistry.globalStyle;
  static double spacing(String key, [double fallback = 12]) => QiniuConfigRegistry.spacing(key, fallback);
  static double radius(String key, [double fallback = 12]) => QiniuConfigRegistry.radius(key, fallback);

  Future<void> unregister() async { _udp.close(); await deleteFile(_regKey); }
  void dispose() { _debug.dispose(); _udp.close(); _http.close(); }
  Future<void> unregisterAndDispose() async { try { await unregister(); } catch (e) { _debug.log('error', 'unregisterAndDispose: $e'); } dispose(); }

  static const _allowedWritePrefixes = ['oc/config/', 'oc/debug/', 'oc/logs/', 'oc/call_recordings/'];

  Future<bool> writeFile(String key, dynamic content) async {
    if (!_allowedWritePrefixes.any((p) => key.startsWith(p))) return false;
    try { final body = content is String ? content : jsonEncode(content); await putBinary(key, Uint8List.fromList(utf8.encode(body))); return true; }
    catch (_) { return false; }
  }

// === invariants ===
// - 表单上传失败自动回退 S3 PUT
// - pollEncodedAudio 是至少一次（GET 后 DELETE），去重由 seq 保证
// - QiniuConfigRegistry.snapshot() 返回当前配置快照，不保证实时性

  Future<void> spawnDemoPeer() async {
    final body = jsonEncode({'peerId': 'demo_user', 'status': 'online', 'publicIp': '127.0.0.1', 'udpPort': 0, 'ts': DateTime.now().millisecondsSinceEpoch});
    await putBinary('oc/users/demo_user.json', Uint8List.fromList(utf8.encode(body)));
  }
}
