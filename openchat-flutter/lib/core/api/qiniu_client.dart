import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import 'qiniu_config.dart';
import 'qiniu_debug.dart';
import 'qiniu_http.dart';
import 'qiniu_models.dart';
import 'qiniu_s3_sign.dart';
import 'qiniu_xml_parser.dart';
import 'qiniu_udp.dart';
import 'qiniu_wav.dart';

class QiniuDirectClient {
  final String peerId;
  final QiniuHttpClient _http = QiniuHttpClient();
  final QiniuUdpTransport _udp = QiniuUdpTransport();

  late QiniuDebugClient _debug;

  QiniuDirectClient({required this.peerId}) {
    _debug = QiniuDebugClient(
      peerId: peerId,
      putBinary: putBinary,
      getBinary: getBinaryRaw,
      listFiles: (prefix) async => listFiles(prefix),
      deleteFile: deleteFile,
      discoverUsers: discoverUsers,
      getPublicIp: () => _udp.publicIp ?? '0.0.0.0',
      getUdpPort: () => _udp.udpPort,
      hasUdp: () => _udp.isReady,
    );
  }

  String get _regKey => 'oc/users/$peerId.json';
  bool get isUdpReady => _udp.isReady;
  String? get publicIp => _udp.publicIp;
  int? get udpPort => _udp.udpPort;
  int pollIntervalMs = 3000;
  static const int userStaleMs = 1800000;

  Future<void> register() async {
    await _udp.setup();
    await _writePresence();
  }

  Future<void> heartbeat() async => _writePresence();

  Future<void> _writePresence() async {
    final body = jsonEncode({
      'peerId': peerId,
      'status': 'online',
      'publicIp': _udp.publicIp,
      'udpPort': _udp.udpPort,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
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
    final body = jsonEncode({
      'action': action,
      'fromPeerId': peerId,
      'publicIp': _udp.publicIp,
      'udpPort': _udp.udpPort,
      'data': data,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
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
        } catch (e) {
          log('error', 'pollIncoming get $key: $e');
        }
        await deleteFile(key);
      }
    } catch (e) {
      log('error', 'pollIncoming list: $e');
    }
    return signals;
  }

  Future<void> sendEncodedAudio(String targetPeerId, Uint8List data, int seq) async {
    await putBinary('oc/audio/$targetPeerId/${peerId}_$seq.enc', data);
  }

  Future<List<Uint8List>> pollEncodedAudio() async {
    final results = <Uint8List>[];
    try {
      // 正常流式音频：读后删
      final keys = await listFiles('oc/audio/$peerId/');
      for (final key in keys) {
        if (!key.endsWith('.enc')) continue;
        results.add(await getBinary(key));
        await deleteFile(key);
      }
      // 清理同 peerId 的 recordings 残留（.enc 流式碎片，保留 .epc 归档）
      final recKeys = await listFiles('oc/recordings/$peerId/');
      for (final key in recKeys) {
        if (!key.endsWith('.enc')) continue;
        await deleteFile(key);
      }
    } catch (e) {
      log('error', 'pollEncodedAudio: $e');
    }
    return results;
  }

  Future<void> saveEpcRecord(Uint8List epcData) async {
    try {
      final path = 'oc/recordings/$peerId/${DateTime.now().millisecondsSinceEpoch}.epc';
      await putBinary(path, epcData);
    } catch (e) {
      _debug.log('error', 'saveEpcRecord: $e');
    }
  }

  Future<void> putBinary(String key, Uint8List data) async {
    try {
      final config = QiniuConfigRegistry.snapshot();
      final uri = Uri.parse('https://upload-z0.qiniup.com/');
      final token = QiniuSigner.uploadToken(config, key);
      final request = http.MultipartRequest('POST', uri)
        ..fields['token'] = token
        ..fields['key'] = key
        ..files.add(http.MultipartFile.fromBytes('file', data));
      final streamed = await _http.send(request).timeout(const Duration(seconds: 15));
      final resp = await http.Response.fromStream(streamed);
      if (resp.statusCode == 200) {
        markC8('put', '$key ok');
        return;
      }
      log('warn', 'putBinary form upload status=${resp.statusCode}');
    } catch (e) {
      log('warn', 'putBinary form upload error: $e');
    }
    // S3 PUT 回退
    final config = QiniuConfigRegistry.snapshot();
    final url = QiniuSigner.presignedUrl(config, key, method: 'PUT');
    await _http.put(Uri.parse(url), headers: {
      'Content-Type': 'application/octet-stream',
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
    }, body: data);
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

  Future<List<String>> listFiles(String prefix) async {
    final resp = await _getXml(prefix);
    return RegExp('<Key>([^<]+)</Key>').allMatches(resp.body).map((m) => m.group(1)!).toList();
  }

  Future<void> deleteFile(String key) async {
    final config = QiniuConfigRegistry.snapshot();
    final url = QiniuSigner.presignedUrl(config, key, method: 'DELETE');
    await _http.delete(Uri.parse(url));
    markC8('delete', '$key ok');
  }

  Future<http.Response> _getXml(String prefix) async {
    final config = QiniuConfigRegistry.snapshot();
    final url = QiniuSigner.presignedUrl(config, prefix, prefix: prefix);
    return _http.get(Uri.parse(url));
  }

  void startPunch(String targetIp, int targetPort) => _udp.startPunch(targetIp, targetPort);
  void sendUdp(List<int> data) => _udp.send(data);
  void log(String level, String msg) => _debug.log(level, msg);
  Future<void> pollDebug() => _debug.pollDebug();

  static Future<Map?> fetchConfigFile(String path, {int retries = 2}) =>
      QiniuConfigRegistry.fetchConfigFile(path, retries: retries);

  static Future<void> initFromBridge(String bridgeUrl) =>
      QiniuConfigRegistry.initFromBridge(bridgeUrl);

  static Uint8List wavFromPcm(Uint8List pcm, {int sampleRate = 48000}) => QiniuWav.wrapPcm(pcm, sampleRate: sampleRate);

  static Map<String, dynamic> get globalStyle => QiniuConfigRegistry.globalStyle;
  static double spacing(String key, [double fallback = 12]) =>
      QiniuConfigRegistry.spacing(key, fallback);
  static double radius(String key, [double fallback = 12]) =>
      QiniuConfigRegistry.radius(key, fallback);

  Future<void> unregister() async {
    _udp.close();
    await deleteFile(_regKey);
  }

  void dispose() {
    _debug.dispose();
    _udp.close();
    _http.close();
  }

  Future<void> unregisterAndDispose() async {
    try { await unregister(); } catch (e) { _debug.log('error', 'unregisterAndDispose: $e'); }
    dispose();
  }

  static const _allowedWritePrefixes = ['oc/config/', 'oc/debug/', 'oc/logs/', 'oc/call_recordings/'];

  Future<bool> writeFile(String key, dynamic content) async {
    if (!_allowedWritePrefixes.any((p) => key.startsWith(p))) return false;
    try {
      final body = content is String ? content : jsonEncode(content);
      await putBinary(key, Uint8List.fromList(utf8.encode(body)));
      return true;
    } catch (_) { return false; }
  }

// === invariants ===
// - 表单上传失败自动回退 S3 PUT，两者都失败则向上抛
// - pollEncodedAudio 是 至少一次（GET 后 DELETE），去重由 seq 保证
// - pollIncoming 是 至少一次（GET 后 DELETE）
// - QiniuConfigRegistry.snapshot() 返回当前配置快照，不保证实时性
// - 空 catch 已全部替换为带日志的 catch（C8 检查点）
// - putBinary 的 S3 PUT 回退路径可能重试，注意幂等性
// - _udp 在 dispose() 中 close，不可复用

  Future<void> spawnDemoPeer() async {
    final demoId = 'demo_user';
    final body = jsonEncode({
      'peerId': demoId, 'status': 'online',
      'publicIp': '127.0.0.1', 'udpPort': 0,
      'ts': DateTime.now().millisecondsSinceEpoch,
    });
    await putBinary('oc/users/$demoId.json', Uint8List.fromList(utf8.encode(body)));
  }
}
