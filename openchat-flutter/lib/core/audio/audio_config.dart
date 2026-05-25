import 'dart:convert';
import '../../core/api/qiniu_direct_client.dart';

class AudioConfig {
  final String mode;
  final int sampleRate;
  final int bufferMs;
  final int pollMs;
  final bool denoise;
  final bool agc;
  final bool highPass;
  final String version;

  const AudioConfig({
    this.mode = 'raw',
    this.sampleRate = 24000,
    this.bufferMs = 1000,
    this.pollMs = 800,
    this.denoise = true,
    this.agc = false,
    this.highPass = true,
    this.version = '1',
  });

  int get bufferBytes => (sampleRate * 2 * bufferMs / 1000).round();

  static Future<AudioConfig> load() async {
    try {
      final raw = await QiniuDirectClient.fetchConfigFile('oc/config/audio.json');
      if (raw == null) return const AudioConfig();
      return AudioConfig(
        mode: raw['mode'] as String? ?? 'raw',
        sampleRate: raw['sampleRate'] as int? ?? 24000,
        bufferMs: raw['bufferMs'] as int? ?? 1000,
        pollMs: raw['pollMs'] as int? ?? 800,
        denoise: raw['denoise'] as bool? ?? true,
        agc: raw['agc'] as bool? ?? false,
        highPass: raw['highPass'] as bool? ?? true,
        version: raw['version'] as String? ?? '1',
      );
    } catch (_) {
      return const AudioConfig();
    }
  }
}
