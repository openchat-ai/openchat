import 'dart:developer' show log;
import 'api/qiniu_direct_client.dart';

class VoiceUiConfig {
  final Map<String, dynamic> raw;

  const VoiceUiConfig([this.raw = const {}]);

  String getString(String key, String def) => raw[key] is String ? raw[key] as String : def;

  String get callingText => getString('callingText', 'Calling {peer}...');
  String get ringingText => getString('ringingText', 'Incoming call...');
  String get connectedText => getString('connectedText', 'Connected to {peer}');
  String get endedText => getString('endedText', 'Call ended');
  String get mutedLabel => getString('mutedLabel', 'MUTED');
  String get relayLabel => getString('relayLabel', 'Qiniu relay');
  String get incomingTitle => getString('incomingTitle', 'Incoming Call');
  String get incomingBody => getString('incomingBody', '{peer} is calling...');
  String get acceptLabel => getString('acceptLabel', 'Accept');
  String get declineLabel => getString('declineLabel', 'Decline');

  String calling(String peer) => callingText.replaceAll('{peer}', peer);
  String connected(String peer) => connectedText.replaceAll('{peer}', peer);
  String incomingBody_(String peer) => incomingBody.replaceAll('{peer}', peer);

  static Future<VoiceUiConfig> load() async {
    try {
      final raw = await QiniuDirectClient.fetchConfigFile('oc/config/ui_voice.json');
      if (raw == null) return const VoiceUiConfig();
      return VoiceUiConfig(raw);
    } catch (e) {
      log('VoiceUiConfig.load error: $e');
      return const VoiceUiConfig();
    }
  }
}
