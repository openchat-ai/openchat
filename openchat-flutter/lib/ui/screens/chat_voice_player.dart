import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' hide log;
import 'dart:typed_data';
import 'package:audioplayers/audioplayers.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/audio.dart';

// === invariants ===
// - _currentPlayer 同一时间只播一个音频，新 playKey 会停旧的
// - _processor 生命周期 = class 生命周期，dispose 时释放

class ChatVoicePlayer {
  AudioPlayer? _currentPlayer;
  LmdnProcessor? _processor;
  QiniuDirectClient? _client;

  Future<void> dispose() async {
    await _currentPlayer?.stop();
    _currentPlayer?.dispose();
    _currentPlayer = null;
    _processor?.dispose();
    _processor = null;
  }

  Future<void> playKey(String key, {LmdnProcessor? codec}) async {
    if (_currentPlayer == null) _currentPlayer = AudioPlayer();
    await _currentPlayer!.stop();
    try {
      final client = await _getClient();
      log('[C14] downloading key=$key');
      final raw = await client.getBinary(key);
      if (raw == null || raw.isEmpty) {
        log('[C14] empty response');
        return;
      }
      log('[C14] raw ${raw.length} B');
      final proc = codec ?? _processor;
      if (proc != null) {
        final decoded = await proc.processReceivedAudio(raw);
        if (decoded.pcm != null && decoded.pcm!.isNotEmpty) {
          log('[C14] decoded ${decoded.pcm!.length} B');
          final src = BytesSource(Uint8List.fromList(decoded.pcm!));
          await _currentPlayer!.play(src, mode: PlayerMode.lowLatency);
          return;
        }
      }
      log('[C14] playing raw bytes');
      final src = BytesSource(Uint8List.fromList(raw));
      await _currentPlayer!.play(src, mode: PlayerMode.lowLatency);
    } catch (e) {
      log('[C14] error: $e');
    }
  }

  Future<QiniuDirectClient> _getClient() async {
    if (_client != null) return _client!;
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'play_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
    _client = QiniuDirectClient(peerId: pid);
    await _client!.register();
    return _client!;
  }
}
