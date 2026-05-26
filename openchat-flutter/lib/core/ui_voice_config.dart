import 'dart:convert';
import 'api/qiniu_direct_client.dart';

class VoiceUiConfig {
  final String callingText;
  final String ringingText;
  final String connectedText;
  final String endedText;
  final String mutedLabel;
  final String relayLabel;
  final String incomingTitle;
  final String incomingBody;
  final String acceptLabel;
  final String declineLabel;

  const VoiceUiConfig({
    this.callingText = 'Calling {peer}...',
    this.ringingText = 'Incoming call...',
    this.connectedText = 'Connected to {peer}',
    this.endedText = 'Call ended',
    this.mutedLabel = 'MUTED',
    this.relayLabel = 'Qiniu relay',
    this.incomingTitle = 'Incoming Call',
    this.incomingBody = '{peer} is calling...',
    this.acceptLabel = 'Accept',
    this.declineLabel = 'Decline',
  });

  String calling(String peer) => callingText.replaceAll('{peer}', peer);
  String connected(String peer) => connectedText.replaceAll('{peer}', peer);
  String incomingBody_(String peer) => incomingBody.replaceAll('{peer}', peer);

  static Future<VoiceUiConfig> load() async {
    try {
      final raw = await QiniuDirectClient.fetchConfigFile('oc/config/ui_voice.json');
      if (raw == null) return const VoiceUiConfig();
      return VoiceUiConfig(
        callingText: raw['callingText'] as String? ?? 'Calling {peer}...',
        ringingText: raw['ringingText'] as String? ?? 'Incoming call...',
        connectedText: raw['connectedText'] as String? ?? 'Connected to {peer}',
        endedText: raw['endedText'] as String? ?? 'Call ended',
        mutedLabel: raw['mutedLabel'] as String? ?? 'MUTED',
        relayLabel: raw['relayLabel'] as String? ?? 'Qiniu relay',
        incomingTitle: raw['incomingTitle'] as String? ?? 'Incoming Call',
        incomingBody: raw['incomingBody'] as String? ?? '{peer} is calling...',
        acceptLabel: raw['acceptLabel'] as String? ?? 'Accept',
        declineLabel: raw['declineLabel'] as String? ?? 'Decline',
      );
    } catch (_) {
      return const VoiceUiConfig();
    }
  }
}
