import 'package:flutter/material.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui_config.dart';
import 'people_dialogs.dart';
import 'people_file_actions.dart';

class SduiActionContext {
  final BuildContext context;
  final List<Map<String, dynamic>> users;
  final QiniuDirectClient? client;
  final Map? uiConfig;
  final VoidCallback onPollUsers;
  final void Function(String peerId) onCall;

  const SduiActionContext({
    required this.context,
    required this.users,
    required this.client,
    required this.uiConfig,
    required this.onPollUsers,
    required this.onCall,
  });
}

class PeopleActionDispatcher {
  static void handle(String action, SduiActionContext ctx) {
    for (final u in ctx.users) {
      if (action == 'call:${u['peerId']}') {
        ctx.onCall(u['peerId'] as String);
        return;
      }
    }
    final client = ctx.client;
    if (client == null) return;
    SduiActions.handle(ctx.context, action,
      onRefresh: ctx.onPollUsers,
      onDemo: () => client.spawnDemoPeer().then((_) => ctx.onPollUsers()),
      custom: {
        'settings': () => Navigator.pushNamed(ctx.context, '/theme'),
        'self_test': () => Navigator.pushNamed(ctx.context, '/voice', arguments: {
          'selfTest': 'true',
          'client': client,
          'targetPeerId': client.peerId,
        }),
        'room:open': () => PeopleDialogs.showRoomDialog(ctx.context),
        'audio_files': () => PeopleDialogs.showAudioFiles(ctx.context, client, ctx.uiConfig),
        'device:info': () => PeopleDialogs.showDeviceInfo(ctx.context, client),
        'config:get': () => PeopleFileActions.showConfig(ctx.context),
        'app:restart': () => PeopleFileActions.restartApp(ctx.context),
      },
    );
    PeopleFileActions.handle(ctx.context, action, client);
  }
}
