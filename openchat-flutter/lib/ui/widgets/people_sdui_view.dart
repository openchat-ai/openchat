import 'package:flutter/material.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui_config.dart';
import '../../core/theme/app_theme.dart';

class PeopleSduiView extends StatelessWidget {
  final List<Map<String, dynamic>> users;
  final Map<String, dynamic> uiConfig;
  final QiniuDirectClient client;
  final AppTheme theme;
  final VoidCallback onRefresh;
  final void Function(String action) onAction;

  const PeopleSduiView({
    super.key,
    required this.users,
    required this.uiConfig,
    required this.client,
    required this.theme,
    required this.onRefresh,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final parser = SduiParser(
      vars: {'peerId': client.peerId, 'userCount': users.length},
      onAction: onAction,
    );
    if (uiConfig['children'] is List) {
      for (int i = 0; i < (uiConfig['children'] as List).length; i++) {
        final child = (uiConfig['children'] as List)[i];
        if (child is Map && child['type'] == 'users_list') {
          (uiConfig['children'] as List)[i] = {
            'type': 'column', 'children': users.map((u) => {
              'type': 'list_tile',
              'leadingIcon': 'person',
              'title': u['peerId'],
              'subtitle': 'Online',
              'trailingIcon': 'call',
              'trailingAction': 'call:${u['peerId']}',
              'action': 'call:${u['peerId']}',
            }).toList(),
          };
        }
      }
    }
    final rendered = parser.parse(uiConfig);
    if (rendered == null) {
      throw StateError('SDUI parse returned null');
    }
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('People', style: TextStyle(color: theme.textPrimary)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: onRefresh, color: theme.textSecondary)],
      ),
      body: rendered,
    );
  }
}
