import 'dart:developer' show log;
import '../api/qiniu_direct_client.dart';

class LmdnConfig {
  final Map<String, dynamic> raw;

  const LmdnConfig([this.raw = const {}]);

  int getInt(String key, int def) => raw[key] is int ? raw[key] as int : def;
  bool getBool(String key, bool def) => raw[key] is bool ? raw[key] as bool : def;
  String getString(String key, String def) => raw[key] is String ? raw[key] as String : def;

  int get sampleRate => getInt('sampleRate', 48000);
  int get bufferMs => getInt('bufferMs', 1000);
  int get pollMs => getInt('pollMs', 800);
  bool get denoise => getBool('denoise', true);
  bool get agc => getBool('agc', false);
  bool get highPass => getBool('highPass', true);
  int get fadeBytes => getInt('fadeBytes', 240);
  int get fadeSamples => getInt('fadeSamples', 48);
  int get demoDelayMs => getInt('demoDelayMs', 3000);

  int get bufferBytes => (sampleRate * 2 * bufferMs / 1000).round();

  static Future<LmdnConfig> load() async {
    try {
      final raw = await QiniuDirectClient.fetchConfigFile('oc/config/audio.json');
      if (raw == null) return const LmdnConfig();
      return LmdnConfig(Map<String, dynamic>.from(raw));
    } catch (e) {
      log('LmdnConfig.load error: $e');
      return const LmdnConfig();
    }
  }
}
