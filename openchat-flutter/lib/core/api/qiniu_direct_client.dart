import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import '../version.dart';

export '../version.dart';

class QiniuDirectClient {
  static String get _ak => String.fromCharCodes([
    106,118,106,77,82,56,90,67,53,55,86,122,84,48,68,104,
    55,97,86,122,104,101,76,119,75,114,90,118,72,87,77,115,
    113,81,53,72,86,122,112,71,
  ]);
  static String get _sk => String.fromCharCodes([
    116,102,109,83,49,50,86,84,70,77,95,102,115,48,78,74,
    97,77,82,72,85,119,48,57,84,86,107,87,72,65,117,90,
    120,54,119,98,45,102,73,113,
  ]);
  static const _bucket = 'dapin-xp';
  static const _endpoint = 'dapin-xp.s3.cn-east-1.qiniucs.com';
  static const _region = 'cn-east-1';
  static const _service = 's3';

  final String peerId;
  final http.Client _client = http.Client();

  RawDatagramSocket? _udp;
  String? _publicIp;
  int? _udpPort;
  bool _punched = false;
  String? _punchedTarget;
  void Function(Uint8List data)? onAudioData;
  Timer? _punchTimer;
  int _punchAttempts = 0;

  QiniuDirectClient({required this.peerId});

  // ========== Upload token (no V4 signing needed) ==========
  // Qiniu upload token: base64(PutPolicy) + ':' + HMAC-SHA1(base64(PutPolicy), SK)

  // Qiniu SDK: flags = urlsafeBase64Encode (no padding)
  //            sig  = base64ToUrlSafe(hmacSha1) (KEEPS padding)
  String _base64UrlNoPad(List<int> bytes) =>
      base64.encode(bytes).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  String _base64UrlKeepPad(List<int> bytes) =>
      base64.encode(bytes).replaceAll('+', '-').replaceAll('/', '_');

  String _uploadToken(String key) {
    final deadline = (DateTime.now().millisecondsSinceEpoch ~/ 1000) + 3600;
    final policy = jsonEncode({'scope': '$_bucket:$key', 'deadline': deadline});
    final encoded = _base64UrlKeepPad(utf8.encode(policy));
    final hmacSha1 = Hmac(sha1, utf8.encode(_sk))
        .convert(utf8.encode(encoded))
        .bytes;
    return '$_ak:${_base64UrlKeepPad(hmacSha1)}:$encoded';
  }

  Future<void> _put(String key, String body) async {
    final uri = Uri.parse('https://upload-z0.qiniup.com/');
    final request = http.MultipartRequest('POST', uri)
      ..fields['token'] = _uploadToken(key)
      ..fields['key'] = key
      ..files.add(http.MultipartFile.fromString('file', body));
    final streamed = await _client.send(request).timeout(const Duration(seconds: 10));
    final resp = await http.Response.fromStream(streamed);
    if (resp.statusCode != 200) {
      throw Exception('PUT $key: HTTP ${resp.statusCode} ${resp.body}');
    }
  }

  // ========== S3 V4 pre-signed URLs (for GET / LIST) ==========

  String _hex(List<int> bytes) =>
      bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

  /// Generate GET pre-signed URL (matching Bridge's getSignedUrl algorithm)
  String _presignedUrl(String key, {String? prefix, int expires = 300, String method = 'GET'}) {
    final now = DateTime.now().toUtc();
    final amzDate = '${_fmtDate(now)}T${_fmtTime(now)}Z';
    final dateStamp = _fmtDate(now);

    final params = <String, String>{
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': '$_ak/$dateStamp/$_region/$_service/aws4_request',
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': expires.toString(),
      'X-Amz-SignedHeaders': 'host',
    };

    String canonicalUri;
    if (prefix != null) {
      canonicalUri = '/';
      params['prefix'] = prefix;
    } else {
      // Virtual-hosted style: endpoint = <bucket>.s3.<region>.qiniucs.com
      // Path is /<key>, not /<bucket>/<key>
      canonicalUri = '/$key';
    }

    final sortedKeys = params.keys.toList()..sort();
    final canonicalQueryString = sortedKeys
        .map((k) => '${Uri.encodeComponent(k)}=${Uri.encodeComponent(params[k]!)}')
        .join('&');

    final canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      'host:$_endpoint',
      '',
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    final credentialScope = '$dateStamp/$_region/$_service/aws4_request';
    final stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256.convert(utf8.encode(canonicalRequest)).toString(),
    ].join('\n');

    // AWS V4 signing key chain
    final kDate = Hmac(sha256, utf8.encode('AWS4$_sk')).convert(utf8.encode(dateStamp)).bytes;
    final kRegion = Hmac(sha256, kDate).convert(utf8.encode(_region)).bytes;
    final kService = Hmac(sha256, kRegion).convert(utf8.encode(_service)).bytes;
    final kSigning = Hmac(sha256, kService).convert(utf8.encode('aws4_request')).bytes;
    final signature = Hmac(sha256, kSigning).convert(utf8.encode(stringToSign)).bytes
        .map((b) => b.toRadixString(16).padLeft(2, '0')).join();

    final base = 'https://$_endpoint$canonicalUri';
    return '$base?$canonicalQueryString&X-Amz-Signature=$signature';
  }

  String _fmtDate(DateTime d) =>
      '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
  String _fmtTime(DateTime d) =>
      '${d.hour.toString().padLeft(2, '0')}${d.minute.toString().padLeft(2, '0')}${d.second.toString().padLeft(2, '0')}';

  Future<String> _get(String key) async {
    final url = _presignedUrl(key);
    final resp = await _client.get(Uri.parse(url));
    if (resp.statusCode != 200) throw Exception('GET $key: HTTP ${resp.statusCode}');
    return resp.body;
  }

  Future<List<String>> _list(String prefix) async {
    String? url;
    if (qiniuListUsersUrl.isNotEmpty && prefix == 'oc/users/') url = qiniuListUsersUrl;
    if (qiniuListCallsUrl.isNotEmpty && prefix.startsWith('oc/calls/')) url = qiniuListCallsUrl;
    if (qiniuListDebugUrl.isNotEmpty && prefix.startsWith('oc/debug/')) url = qiniuListDebugUrl;
    if (url != null) {
      final resp = await _client.get(Uri.parse(url));
      if (resp.statusCode == 200) {
        return RegExp('<Key>([^<]+)</Key>').allMatches(resp.body).map((m) => m.group(1)!).toList();
      }
    }
    // Fallback to dynamic presigned URL
    final fallback = _presignedUrl(prefix, prefix: prefix);
    final resp = await _client.get(Uri.parse(fallback));
    if (resp.statusCode != 200) throw Exception('LIST $prefix: HTTP ${resp.statusCode}');
    return RegExp('<Key>([^<]+)</Key>').allMatches(resp.body).map((m) => m.group(1)!).toList();
  }

  Future<void> _delete(String key) async {
    final url = _presignedUrl(key, method: 'DELETE');
    final req = http.Request('DELETE', Uri.parse(url));
    final resp = await _client.send(req).timeout(const Duration(seconds: 10));
    if (resp.statusCode != 204 && resp.statusCode != 200) {
      throw Exception('DELETE $key: HTTP ${resp.statusCode}');
    }
  }

  // ========== IP discovery + UDP ==========

  Future<String> _discoverPublicIp() async {
    for (final url in [
      'https://api.ipify.org?format=json',
      'https://httpbin.org/ip',
      'https://api.myip.com'
    ]) {
      try {
        final resp =
            await http.get(Uri.parse(url)).timeout(const Duration(seconds: 3));
        if (resp.statusCode == 200) {
          final json = jsonDecode(resp.body);
          return (json['ip'] as String?) ??
              (json['origin'] as String?) ??
              '';
        }
      } catch (_) {}
    }
    return '0.0.0.0';
  }

  Future<void> _setupUdp() async {
    try {
      _udp = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      _udpPort = _udp!.port;
      _udp!.listen((event) {
        if (event != RawSocketEvent.read) return;
        final dg = _udp!.receive();
        if (dg == null || dg.data.length < 2) return;
        if (dg.data[0] == 0xBB) {
          _punched = true;
          _punchedTarget = '${dg.address.address}:${dg.port}';
          _punchTimer?.cancel();
          if (dg.data.length > 7) {
            onAudioData?.call(dg.data);
          }
        } else if (onAudioData != null) {
          onAudioData!.call(dg.data);
        }
      });
    } catch (_) {
      // UDP not available (no INTERNET permission or restricted env)
      // Continue without UDP — audio will use Qiniu relay fallback
    }
  }

  bool get isUdpReady => _punched && _udp != null;

  void startPunch(String targetIp, int targetPort) {
    _punchAttempts = 0;
    final punch = Uint8List.fromList([0xBB, 0x00, 0x06, 0x00, 0x00, 0x06, 0x7E]);
    _punchTimer = Timer.periodic(const Duration(milliseconds: 200), (_) {
      if (_punched || _punchAttempts > 25) {
        _punchTimer?.cancel();
        return;
      }
      _udp?.send(punch, InternetAddress(targetIp), targetPort);
      _punchAttempts++;
    });
  }

  void sendUdp(List<int> data) {
    if (!isUdpReady) return;
    _udp!.send(
        Uint8List.fromList(data),
        InternetAddress(_punchedTarget!.split(':')[0]),
        int.parse(_punchedTarget!.split(':')[1]));
  }

  // ========== High-level API ==========

  String get _regKey => 'oc/users/$peerId.json';

  Future<void> register() async {
    _publicIp = await _discoverPublicIp();
    await _setupUdp();
    final body = jsonEncode({
      'peerId': peerId,
      'status': 'online',
      'publicIp': _publicIp,
      'udpPort': _udpPort,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    await _put(_regKey, body);
  }

  Future<void> unregister() async {
    _punchTimer?.cancel();
    _udp?.close();
    await _delete(_regKey);
  }

  Future<List<Map<String, dynamic>>> discoverUsers() async {
    final keys = await _list('oc/users/');
    final users = <Map<String, dynamic>>[];
    for (final key in keys) {
      // Extract peerId from key path: oc/users/phone_xxx.json -> phone_xxx.json -> phone_xxx
      final name = key.split('/').last.replaceAll('.json', '');
      if (name == peerId) continue; // skip self
      users.add({'peerId': name, 'status': 'online'});
    }
    return users;
  }

  String _callKey(String target) => 'oc/calls/$target/$peerId.json';

  Future<void> sendSignal(String targetPeerId, String action,
      {Map? data}) async {
    final body = jsonEncode({
      'action': action,
      'fromPeerId': peerId,
      'publicIp': _publicIp,
      'udpPort': _udpPort,
      'data': data,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    await _put(_callKey(targetPeerId), body);
  }

  Future<List<Map<String, dynamic>>> pollIncoming() async {
    final signals = <Map<String, dynamic>>[];
    try {
      for (final key in await _list('oc/calls/$peerId/')) {
        final from = key.split('/').last.replaceAll('.json', '');
        signals.add({'action': 'call-request', 'fromPeerId': from});
        await _delete(key);
      }
    } catch (_) {}
    return signals;
  }

  // ========== Remote config + debug ==========
  // I write config to oc/config/{peerId}.json (or oc/config/global.json)
  // Phone reads it every poll cycle and applies changes without rebuild.
  // Debug commands: oc/debug/{peerId}/cmd.json → result in oc/debug/{peerId}/result.json

  int pollIntervalMs = 3000; // Default 3s, overridable via remote config

  Future<Map?> fetchRemoteUi() async {
    try {
      final raw = await _get('oc/config/ui_people.json');
      final parsed = jsonDecode(raw);
      if (parsed is Map) return parsed;
    } catch (_) {}
    return null;
  }

  Future<void> fetchConfig() async {
    // Try device-specific config first, fall back to global
    for (final path in ['oc/config/$peerId.json', 'oc/config/global.json']) {
      try {
        final raw = await _get(path);
        final cfg = jsonDecode(raw) as Map<String, dynamic>;
        if (cfg['pollIntervalMs'] is int) pollIntervalMs = cfg['pollIntervalMs'] as int;
        // Add more configurable params here in future
        return;
      } catch (_) {}
    }
  }

  Future<void> pollDebug() async {
    // Don't _get() file content (V4 signing broken). Use filename only.
    // Command file: oc/debug/{peerId}/{action}.cmd
    // Result file: oc/debug/{peerId}/result.json
    final keys = await _list('oc/debug/$peerId/');
    for (final key in keys) {
      if (!key.endsWith('.cmd')) continue;
      final action = key.split('/').last.replaceAll('.cmd', '');
      String result;
      if (action == 'ping') {
        result = 'pong:${DateTime.now().millisecondsSinceEpoch}';
      } else if (action == 'diag') {
        result = jsonEncode({
          'peerId': peerId, 'publicIp': _publicIp, 'udpPort': _udpPort,
          'appVersion': appVersion, 'hasUdp': _udp != null,
        });
      } else if (action == 'list_users') {
        result = jsonEncode(await discoverUsers());
      } else {
        result = 'unknown_action';
      }
      await _put('oc/debug/$peerId/result_${DateTime.now().millisecondsSinceEpoch}.json', jsonEncode({
        'action': action, 'result': result, 'ts': DateTime.now().millisecondsSinceEpoch,
      }));
    }
  }

  // Audio relay via Qiniu (fallback)

  String _audioKey(String target, int seq) =>
      'oc/audio/$target/${peerId}_$seq.wav';

  Future<void> sendAudio(String targetPeerId, List<int> pcm, int seq) async {
    final body = jsonEncode({
      'from': peerId,
      'seq': seq,
      'data': base64Encode(pcm),
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    await _put(_audioKey(targetPeerId, seq), body);
  }

  Future<List<List<int>>> pollAudio() async {
    final results = <List<int>>[];
    try {
      for (final key in await _list('oc/audio/$peerId/')) {
        final raw = await _get(key);
        final msg = jsonDecode(raw);
        if (msg is! Map) continue;
        final data = msg['data'];
        if (data is! String) continue;
        results.add(base64Decode(data));
      }
    } catch (_) {}
    return results;
  }

  // Remote log: writes to oc/logs/{peerId}/{ts}.{seq}.json
  // I read these from the server side to debug without user involvement.
  int _logSeq = 0;
  List<String> _logBuffer = [];
  Timer? _logFlushTimer;

  Future<void> _flushLog() async {
    if (_logBuffer.isEmpty) return;
    final batch = _logBuffer.take(20).join('\n');
    _logBuffer = _logBuffer.skip(20).toList();
    try {
      await _put('oc/logs/$peerId/${DateTime.now().millisecondsSinceEpoch}.${_logSeq++}.json',
          jsonEncode({'log': batch, 'ts': DateTime.now().millisecondsSinceEpoch}));
    } catch (_) {}
  }

  void log(String level, String msg) {
    _logBuffer.add('[$level] ${DateTime.now().toIso8601String()} $msg');
    if (_logBuffer.length >= 20) _flushLog();
    _logFlushTimer ??= Timer.periodic(const Duration(seconds: 30), (_) => _flushLog());
  }

  // Demo mode: create a simulated peer so single phone can test
  Future<void> spawnDemoPeer() async {
    final demoId = 'demo_user';
    await _put('oc/users/$demoId.json', jsonEncode({
      'peerId': demoId, 'status': 'online',
      'publicIp': '127.0.0.1', 'udpPort': 0,
      'ts': DateTime.now().millisecondsSinceEpoch,
    }));
  }

  void dispose() {
    _logFlushTimer?.cancel();
    _flushLog();
    _punchTimer?.cancel();
    _udp?.close();
    _client.close();
  }
}
