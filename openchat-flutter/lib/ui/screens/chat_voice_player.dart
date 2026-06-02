import 'dart:async';
import 'dart:developer' show log;
import 'package:audioplayers/audioplayers.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/lmdn_codec.dart';
import '../../core/ui_voice_config.dart';

// === invariants ===
// - playKey 每次调用前先 stop（防止重叠播放）
// - _player 在 dispose() 前必须 dispose
// - getBinary 失败时返回 null，不抛异常

class ChatVoicePlayer {
  QiniuDirectClient? _client;
  AudioPlayer? _player;
  LmdnProcessor? _processor;

  Future<void> dispose() {
    _player?.dispose();
    _processor?.dispose();
    _client?.dispose();
  }

  Future<bool> playKey(String key) async {
    // === C14: 下载 → 解码 → 播放 ===
    try {
      final client = await _getClient();
      log('[C14] download start key=$key');
      // TODO: getBinary → download LMDN data
      // TODO: processReceivedAudio → decode PCM
      // TODO: wavFromPcm → audioplayers.play
      return false;
    } catch (e) {
      log('[C14] error: $e');
      return false;
    }
  }

  Future<QiniuDirectClient> _getClient() async {
    if (_client != null) return _client!;
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'play_${DateTime.now().millisecondsSinceEpoch}';
    _client = QiniuDirectClient(peerId: pid);
    await _client!.register();
    return _client!;
  }
}
