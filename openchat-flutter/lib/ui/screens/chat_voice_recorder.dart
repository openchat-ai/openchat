import 'dart:async';
import 'dart:developer' show log;
import 'dart:typed_data';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/lmdn_codec.dart';
import '../../core/ui_voice_config.dart';

// === invariants ===
// - _vmBuffer 只在 startRecord/stopRecord 间由 stream.listen 追加
// - stopRecord 后 _vmBuffer.clear()，防止残留
// - 同一时刻只有一个录音流在运行（_vmRecording 守卫）

class ChatVoiceRecorder {
  QiniuDirectClient? _client;
  AudioRecorder? _recorder;
  LmdnProcessor? _processor;
  StreamSubscription? _sub;
  final List<int> _vmBuffer = [];
  bool _vmRecording = false;

  Future<void> dispose() {
    _sub?.cancel();
    _recorder?.dispose();
    _processor?.dispose();
    _client?.dispose();
    _vmBuffer.clear();
    _vmRecording = false;
  }

  Future<bool> startRecord() async {
    // === C10: 录音开始 ===
    if (_vmRecording) return false;
    _vmBuffer.clear();
    try {
      // TODO: 初始化 recorder / processor / client
      // TODO: 请求麦克风权限
      // TODO: startStream → listen _vmBuffer.addAll
    } catch (e) {
      log('[C10] init error: $e');
    }
    return _vmRecording;
  }

  Future<String?> stopRecord({required String chatId}) async {
    // === C11: 编码 ===
    if (!_vmRecording) return null;
    _vmRecording = false;
    await _sub?.cancel();
    _sub = null;
    await _recorder?.stop();
    if (_vmBuffer.isEmpty) {
      log('[C11] empty buffer');
      return null;
    }
    final pcm = Uint8List.fromList(_vmBuffer);
    _vmBuffer.clear();
    log('[C11] raw pcm ${pcm.length} B');
    try {
      // TODO: processMicrophoneInput → encode
      // TODO: putBinary → upload S3
      // TODO: return S3 key
      return null;
    } catch (e) {
      log('[C11/C12] error: $e');
      return null;
    }
  }

  Future<QiniuDirectClient> _getClient() async {
    if (_client != null) return _client!;
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'rec_${DateTime.now().millisecondsSinceEpoch}';
    _client = QiniuDirectClient(peerId: pid);
    await _client!.register();
    return _client!;
  }
}
