import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' hide log;
import 'dart:typed_data';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/audio.dart';
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
    _sub = null;
    _recorder?.dispose();
    _recorder = null;
    _processor?.dispose();
    _processor = null;
    _client?.dispose();
    _client = null;
    _vmBuffer.clear();
    _vmRecording = false;
  }

  Future<bool> startRecord() async {
    if (_vmRecording) return false;
    _vmBuffer.clear();
    try {
      if (_recorder == null) _recorder = AudioRecorder();
      if (_processor == null) {
        final cfg = await LmdnConfig.load();
        _processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: false, enableCodec: true);
        await _processor!.initialize();
      }
      if (await _recorder!.hasPermission() != true) {
        await _recorder!.hasPermission(request: true);
        if (await _recorder!.hasPermission() != true) {
          log('[C10] mic denied');
          return false;
        }
      }
      final sr = _processor!.sampleRate;
      final stream = await _recorder!.startStream(RecordConfig(
        encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: sr));
      if (stream == null) {
        log('[C10] stream null');
        return false;
      }
      _vmRecording = true;
      log('[C10] recording start sr=$sr');
      _sub = stream.listen((chunk) {
        _vmBuffer.addAll(chunk);
      }, onError: (e) {
        log('[C10] stream error: $e');
        _vmRecording = false;
      });
      return true;
    } catch (e) {
      log('[C10] init error: $e');
      return false;
    }
  }

  Future<String?> stopRecord({required String chatId}) async {
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
      final encoded = await _processor?.processMicrophoneInput(pcm);
      if (encoded == null) {
        log('[C11] encode fail');
        return null;
      }
      log('[C11] encoded ${pcm.length} -> ${encoded.length} B');
      final client = await _getClient();
      final ts = DateTime.now().millisecondsSinceEpoch;
      final key = 'oc/chat/$chatId/$ts.enc';
      await client.putBinary(key, encoded);
      log('[C12] uploaded key=$key');
      return key;
    } catch (e) {
      log('[C11/C12] error: $e');
      return null;
    }
  }

  Future<QiniuDirectClient> _getClient() async {
    if (_client != null) return _client!;
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'rec_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
    _client = QiniuDirectClient(peerId: pid);
    await _client!.register();
    return _client!;
  }
}
