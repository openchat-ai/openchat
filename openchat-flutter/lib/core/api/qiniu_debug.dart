import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'qiniu_config.dart';
import 'qiniu_models.dart';
import 'qiniu_s3_sign.dart';

/// Remote debug command executor + log buffer + checkpoint markers.
/// Allows server to trigger actions on the phone via oc/debug/{peerId}/cmd.json.
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
    required this.peerId,
    required this.putBinary,
    required this.getBinary,
    required this.listFiles,
    required this.deleteFile,
    required this.discoverUsers,
    required this.getPublicIp,
    required this.getUdpPort,
    required this.hasUdp,
    this.appVersion = '',
  });

  /// Remote log buffer; writes to oc/logs/{peerId}/{ts}.{seq}.json.
  int _logSeq = 0;
  List<String> _logBuffer = [];
  Timer? _logFlushTimer;

  Future<void> _flushLog() async {
    if (_logBuffer.isEmpty) return;
    final batch = _logBuffer.take(20).join('\n');
    _logBuffer = _logBuffer.skip(20).toList();
    try {
      await putBinary(
        'oc/logs/$peerId/${DateTime.now().millisecondsSinceEpoch}.${_logSeq++}.json',
        Uint8List.fromList(utf8.encode(
            jsonEncode({'log': batch, 'ts': DateTime.now().millisecondsSinceEpoch}))),
      );
    } catch (_) {}
  }

  void log(String level, String msg) {
    _logBuffer.add('[$level] ${DateTime.now().toIso8601String()} $msg');
    if (_logBuffer.length >= 20) _flushLog();
    _logFlushTimer ??= Timer.periodic(const Duration(seconds: 30), (_) => _flushLog());
  }

  /// Poll debug commands from oc/debug/{peerId}/.
  Future<void> pollDebug() async {
    final keys = await listFiles('oc/debug/$peerId/');
    for (final key in keys) {
      if (!key.endsWith('.cmd')) continue;
      final action = key.split('/').last.replaceAll('.cmd', '');
      String result;
      try {
        result = await _execDebug(action);
      } catch (e) {
        result = 'error: $e';
      }
      await putBinary(
        'oc/debug/$peerId/result_${DateTime.now().millisecondsSinceEpoch}.json',
        Uint8List.fromList(utf8.encode(jsonEncode({
          'action': action,
          'result': result,
          'ts': DateTime.now().millisecondsSinceEpoch,
        }))),
      );
    }
  }

  Future<String> _execDebug(String action) async {
    if (action == 'ping') return 'pong:${DateTime.now().millisecondsSinceEpoch}';
    if (action == 'diag') {
      return jsonEncode({
        'peerId': peerId,
        'publicIp': getPublicIp(),
        'udpPort': getUdpPort(),
        'appVersion': appVersion,
        'hasUdp': hasUdp(),
      });
    }
    if (action == 'list_users') return jsonEncode(await discoverUsers());
    if (action == 'test_put') {
      await putBinary('oc/config/test_put.json', Uint8List.fromList('{}'.codeUnits));
      return 'ok';
    }
    if (action == 'test_get') {
      final data = await getBinary('oc/config/audio.json');
      return String.fromCharCodes(data);
    }
    if (action == 'test_delete') {
      await deleteFile('oc/config/test_del.json');
      return 'ok';
    }
    if (action == 'test_list') {
      return jsonEncode(await listFiles('oc/config/'));
    }
    return 'unknown_action';
  }

  void dispose() {
    _logFlushTimer?.cancel();
    _flushLog();
  }
}

/// Checkpoint markers for grep [C8] [C9] in logs.
void markC8(String op, String detail) {
  // eslint-disable-next-line no-print
  print('[C8] $op $detail');
}

void markC9(String action, String detail) {
  // eslint-disable-next-line no-print
  print('[C9] $action $detail');
}
