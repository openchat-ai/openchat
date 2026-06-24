import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/api/base_client.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui_config.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import '../screens/screens.dart';

enum CardVariant { filled, outlined, elevated, gradient, glass }

class AppCard extends ConsumerWidget {
  final Widget child;
  final CardVariant variant;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final double? width;
  final double? height;
  final BorderRadius? borderRadius;
  final List<Color>? gradientColors;
  final bool isSelected;

  const AppCard({
    super.key,
    required this.child,
    this.variant = CardVariant.filled,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    this.width,
    this.height,
    this.borderRadius,
    this.gradientColors,
    this.isSelected = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    Widget card = Container(
      width: width,
      height: height,
      padding: padding,
      decoration: _buildDecoration(theme),
      child: child,
    );
    if (onTap != null) {
      card = GestureDetector(
        onTap: onTap,
        child: AnimatedScale(
          scale: 1.0,
          duration: const Duration(milliseconds: 150),
          child: card,
        ),
      );
    }
    return card;
  }

  BoxDecoration _buildDecoration(AppTheme theme) {
    final radius = borderRadius ?? BorderRadius.circular(theme.radiusMedium);
    switch (variant) {
      case CardVariant.filled:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: radius,
          border: Border.all(
            color: isSelected
              ? theme.primary.withValues(alpha: 0.5)
              : theme.textTertiary.withValues(alpha: 0.1),
            width: isSelected ? 2 : 1,
          ),
        );
      case CardVariant.outlined:
        return BoxDecoration(
          color: Colors.transparent,
          borderRadius: radius,
          border: Border.all(
            color: isSelected
              ? theme.primary
              : theme.textTertiary.withValues(alpha: 0.2),
            width: isSelected ? 2 : 1,
          ),
        );
      case CardVariant.elevated:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.8),
          borderRadius: radius,
          boxShadow: theme.shadows,
        );
      case CardVariant.gradient:
        return BoxDecoration(
          gradient: LinearGradient(
            colors: gradientColors ?? theme.gradientPrimary,
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: radius,
          boxShadow: theme.useGlow ? [
            BoxShadow(
              color: (gradientColors ?? theme.gradientPrimary)[0].withValues(alpha: 0.4),
              blurRadius: 20,
              spreadRadius: 2,
            ),
          ] : null,
        );
      case CardVariant.glass:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.3),
          borderRadius: radius,
          border: Border.all(color: Colors.white.withValues(alpha: 0.1), width: 1),
        );
    }
  }
}

// ===== list_card.dart =====
class ListCard extends ConsumerWidget {
  final Widget? leading;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showDivider;
  final Color? leadingColor;

  const ListCard({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.showDivider = false,
    this.leadingColor,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    return Column(
      children: [
        AppCard(
          variant: CardVariant.filled,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          onTap: onTap,
          child: Row(
            children: [
              if (leading != null) ...[
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        (leadingColor ?? theme.gradientPrimary[0]).withValues(alpha: 0.2),
                        (leadingColor ?? theme.gradientPrimary[0]).withValues(alpha: 0.05),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(child: leading),
                ),
                const SizedBox(width: 14),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: theme.textPrimary,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        subtitle!,
                        style: TextStyle(color: theme.textSecondary, fontSize: 13),
                      ),
                    ],
                  ],
                ),
              ),
              if (trailing != null) trailing!,
            ],
          ),
        ),
        if (showDivider)
          Divider(
            indent: 72,
            endIndent: 16,
            color: theme.textTertiary.withValues(alpha: 0.1),
            height: 1,
          ),
      ],
    );
  }
}

// ===== bridge_url_tile.dart =====
class BridgeUrlTile extends ConsumerStatefulWidget {
  final AppTheme theme;
  const BridgeUrlTile({super.key, required this.theme});

  @override
  ConsumerState<BridgeUrlTile> createState() => _BridgeUrlTileState();
}

class _BridgeUrlTileState extends ConsumerState<BridgeUrlTile> {
  late TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(configProvider).baseUrl);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final config = ref.watch(configProvider);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Bridge 鍦板潃', style: TextStyle(color: widget.theme.textSecondary, fontSize: 13)),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(child: TextField(
            controller: _controller,
            style: TextStyle(color: widget.theme.textPrimary),
            decoration: InputDecoration(
              hintText: 'http://192.168.1.100:3800',
              hintStyle: TextStyle(color: widget.theme.textTertiary),
              filled: true, fillColor: widget.theme.surface,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: widget.theme.textTertiary.withValues(alpha: 0.2))),
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10)),
          )),
          const SizedBox(width: 8),
          TextButton(onPressed: () {
            ref.read(configProvider.notifier).setBaseUrl(_controller.text);
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Address updated'), duration: Duration(seconds: 2)));
          }, child: const Text('Save')),
        ]),
        const SizedBox(height: 4),
        Text('Current: ${config.baseUrl}', style: TextStyle(color: widget.theme.textTertiary, fontSize: 11)),
      ]),
    );
  }
}

// ===== people_dialogs.dart =====
class PeopleDialogs {
  static Future<void> showSdui(
    BuildContext context,
    Map layout,
    Map<String, dynamic> vars, {
    List<Map<String, String>>? actions,
    void Function(String)? onAction,
  }) {
    final parser = SduiParser(vars: vars, onAction: onAction);
    return showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        content: SizedBox(width: double.maxFinite, child: parser.parse(layout)),
        actions: actions?.map((a) => TextButton(
          onPressed: () => onAction?.call(a['action'] ?? ''),
          child: Text(a['label'] ?? '', style: a['color'] != null ? TextStyle(color: Color(int.parse(a['color']!.replaceAll('#', '0xFF')))) : null),
        )).toList() ?? [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
  }

  static Future<void> showRoomDialog(BuildContext context) async {
    final controller = TextEditingController(text: 'room_${DateTime.now().millisecondsSinceEpoch}');
    await showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('鍔犲叆璇煶鎴块棿'),
      content: TextField(
        controller: controller,
        decoration: const InputDecoration(labelText: '\u623F\u95F4 ID', hintText: '\u8F93\u5165\u623F\u95F4 ID \u6216\u4F7F\u7528\u9ED8\u8BA4'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('鍙栨秷')),
        TextButton(onPressed: () {
          Navigator.pop(ctx);
          Navigator.pushNamed(context, '/room', arguments: controller.text.trim());
        }, child: const Text('鍔犲叆', style: TextStyle(color: Color(0xFF7C4DFF)))),
      ],
    ));
  }

  static Future<void> showAudioFiles(BuildContext context, QiniuDirectClient client, Map? uiConfig) async {
    final keys = await client.listFiles('oc/audio/');
    final items = keys.map((k) => <String, dynamic>{'key': k, 'size': 0}).toList();
    if (!context.mounted) return;
    final layout = uiConfig?['audioFilesLayout'];
    final parser = SduiParser(vars: {
      'files': items.map((f) => {
        'name': (f['key'] as String? ?? '').split('/').last,
        'size': () {
          final s = f['size'] as int? ?? 0;
          return s >= 1024 ? '${(s / 1024).toStringAsFixed(1)}KB' : '${s}B';
        }(),
      }).toList(),
    }, onAction: null);
    final body = layout is Map
      ? parser.parse(layout)
      : parser.parse({
          'type': 'column', 'children': [
            {'type': 'for_each', 'items': '{{files}}', 'template': {
              'type': 'column', 'children': [
                {'type': 'divider'},
                {'type': 'row', 'children': [
                  {'type': 'text', 'content': '{{item.name}}', 'pad': 8},
                  {'type': 'spacer'},
                  {'type': 'text', 'content': '{{item.size}}', 'style': {'color': '#9E9E9E', 'size': 12}, 'pad': 8},
                ]},
              ],
            }},
          ],
        });
    if (!context.mounted) return;
    showDialog(context: context, builder: (ctx) => AlertDialog(
      content: SizedBox(width: double.maxFinite, child: body),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
    ));
  }

  static void showDeviceInfo(BuildContext context, QiniuDirectClient client) {
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Device Info'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Peer ID: ${client.peerId}'),
        const SizedBox(height: 8),
        Text('Poll: ${client.pollIntervalMs}ms'),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
    ));
  }
}

// ===== people_error_view.dart =====
class PeopleErrorView extends StatelessWidget {
  final String? error;
  final AppTheme theme;
  final VoidCallback onRetry;

  const PeopleErrorView({
    super.key,
    required this.error,
    required this.theme,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final err = error ?? '';
    String type, hint;
    if (err.contains('Timeout') || err.contains('timed out')) {
      type = 'Network timeout';
      hint = 'Check your internet connection\nQiniu may be blocked by your ISP';
    } else if (err.contains('401') || err.contains('bad token') || err.contains('BadToken')) {
      type = 'Auth failed';
      hint = 'Upload token invalid\nRebuild APK to refresh token';
    } else if (err.contains('403') || err.contains('Signature')) {
      type = 'Signature mismatch';
      hint = 'S3 signing algorithm mismatch\nContact developer';
    } else if (err.contains('SocketException') || err.contains('Connection refused')) {
      type = 'Connection failed';
      hint = 'Cannot reach Qiniu server\nCheck firewall or try different network';
    } else if (err.contains('DNS')) {
      type = 'DNS resolution failed';
      hint = 'Cannot resolve qiniu.com\nCheck DNS settings';
    } else if (err.contains('InvalidAccessKeyId')) {
      type = 'Access key invalid';
      hint = 'Qiniu access key rejected\n$err';
    } else {
      type = 'Unknown error';
      hint = err;
    }
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, color: theme.warning, size: 48),
            const SizedBox(height: 16),
            Text(type, style: TextStyle(color: theme.error, fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Text(hint, style: TextStyle(color: theme.textSecondary, fontSize: 13), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.surface.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(err, style: TextStyle(color: theme.textTertiary, fontSize: 10), textAlign: TextAlign.center),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

// ===== people_fallback_view.dart =====
class PeopleFallbackView extends StatelessWidget {
  final bool loading;
  final String? error;
  final List<Map<String, dynamic>> users;
  final QiniuDirectClient? client;
  final AppTheme theme;
  final Future<void> Function() onRefresh;
  final VoidCallback onSpawnDemo;
  final void Function(String peerId) onCall;

  const PeopleFallbackView({
    super.key,
    required this.loading,
    required this.error,
    required this.users,
    required this.client,
    required this.theme,
    required this.onRefresh,
    required this.onSpawnDemo,
    required this.onCall,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('People', style: TextStyle(color: theme.textPrimary)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: onRefresh, color: theme.textSecondary)],
      ),
      body: loading
          ? Center(child: CircularProgressIndicator(color: theme.accent))
          : error != null
              ? PeopleErrorView(error: error, theme: theme, onRetry: onRefresh)
              : users.isEmpty
                  ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.person_outline, color: theme.textTertiary, size: 48),
                      const SizedBox(height: 16),
                      Text('No one online', style: TextStyle(color: theme.textSecondary)),
                      const SizedBox(height: 8),
                      Text('Tap Demo to test with a simulated user',
                          style: TextStyle(color: theme.textTertiary, fontSize: 12)),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: client == null ? null : onSpawnDemo,
                        icon: const Icon(Icons.smart_toy_outlined, size: 16),
                        label: const Text('Demo'),
                      ),
                    ]))
                  : RefreshIndicator(
                      onRefresh: onRefresh,
                      child: ListView.builder(
                        itemCount: users.length,
                        itemBuilder: (ctx, i) {
                          final user = users[i];
                          final peerId = user['peerId'] as String? ?? 'unknown';
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: theme.accent.withValues(alpha: 0.2),
                              child: Icon(Icons.person, color: theme.accent),
                            ),
                            title: Text(peerId, style: TextStyle(color: theme.textPrimary)),
                            subtitle: Text('Online', style: TextStyle(color: theme.success, fontSize: 12)),
                            trailing: IconButton(
                              icon: Icon(Icons.call, color: theme.gradientAccent[0]),
                              onPressed: () => onCall(peerId),
                            ),
                            onTap: () => onCall(peerId),
                          );
                        },
                      ),
                    ),
    );
  }
}

// ===== people_file_actions.dart =====
class PeopleFileActions {
  static void handle(BuildContext context, String action, QiniuDirectClient client) {
    final qIdx = action.indexOf('?');
    final params = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1)) : <String, String>{};
    if (action.startsWith('file:list?')) {
      client.listFiles(params['prefix'] ?? '').then((files) {
        if (!context.mounted) return;
        PeopleDialogs.showSdui(context,
          {'type': 'column', 'children': [
            {'type': 'text', 'content': 'Files: ${params['prefix'] ?? ""}', 'style': {'bold': true}, 'pad': 8},
            {'type': 'for_each', 'items': 'files', 'template': {'type': 'list_tile', 'title': '{{name}}'}}
          ]},
          {'files': files.map((f) => {'name': f.split('/').last}).toList()});
      });
    } else if (action.startsWith('file:delete?')) {
      final key = params['key'] ?? '';
      if (key.isEmpty) return;
      PeopleDialogs.showSdui(context,
        {'type': 'column', 'children': [
          {'type': 'text', 'content': 'Delete?', 'style': {'bold': true}, 'pad': 8},
          {'type': 'text', 'content': key, 'pad': 8}
        ]},
        {},
        actions: [
          {'action': 'cancel', 'label': 'Cancel'},
          {'action': 'del', 'label': 'Delete', 'color': '#F44336'}
        ],
        onAction: (a) {
          if (a == 'cancel') Navigator.of(context).pop();
          if (a == 'del') { client.deleteFile(key); Navigator.of(context).pop(); }
        });
    } else if (action.startsWith('file:get?')) {
      final qIdx = action.indexOf('?');
      final key = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1))['key'] ?? '' : '';
      if (key.isEmpty) return;
      client.getBinary(key).then((data) {
        if (!context.mounted) return;
        final content = String.fromCharCodes(data);
        PeopleDialogs.showSdui(context,
          {'type': 'column', 'children': [
            {'type': 'text', 'content': key.split('/').last, 'style': {'bold': true}, 'pad': 8},
            {'type': 'text', 'content': content, 'style': {'size': 10}}
          ]},
          {});
      });
    } else if (action.startsWith('file:write?')) {
      final qIdx = action.indexOf('?');
      if (qIdx < 0) return;
      final params = Uri.splitQueryString(action.substring(qIdx + 1));
      final key = params['key'] ?? '';
      final value = params['value'] ?? '';
      if (key.isEmpty || value.isEmpty) return;
      client.writeFile(key, value).then((ok) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(ok ? 'Written: $key' : 'Write failed: $key')));
      });
    } else if (action.startsWith('config:set?')) {
      _handleConfigSet(context, action);
    }
  }

  static Future<void> _handleConfigSet(BuildContext context, String action) async {
    final qIdx = action.indexOf('?');
    if (qIdx < 0) return;
    final params = Uri.splitQueryString(action.substring(qIdx + 1));
    final key = params['key'];
    final value = params['value'];
    if (key == null || value == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
    if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Config set: $key=$value')));
  }

  static Future<void> showConfig(BuildContext context) async {
    final prefs = await SharedPreferences.getInstance();
    final keys = ['peerId', 'bridge_url', 'theme_mode'].where((k) => prefs.containsKey(k));
    final items = keys.map((k) => '$k: ${prefs.get(k)}').join('\n');
    PeopleDialogs.showSdui(context,
      {'type': 'column', 'children': [
        {'type': 'text', 'content': items.isEmpty ? '(no config)' : items, 'style': {'size': 13}}
      ]},
      {});
  }

  static void restartApp(BuildContext context) {
    PeopleDialogs.showSdui(context,
      {'type': 'column', 'children': [
        {'type': 'text', 'content': 'Restart app for changes to take effect', 'pad': 8}
      ]},
      {},
      actions: [
        {'action': 'cancel', 'label': 'Cancel'},
        {'action': 'restart', 'label': 'Restart', 'color': '#7C4DFF'}
      ],
      onAction: (a) {
        if (a == 'cancel') Navigator.of(context).pop();
        if (a == 'restart') {
          Navigator.pop(context);
          Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
            (r) => false);
          Future.delayed(const Duration(milliseconds: 100), () => Navigator.of(context).pushAndRemoveUntil(
            MaterialPageRoute(builder: (_) => const MainScreen()),
            (r) => false));
        }
      });
  }
}

// ===== people_action_dispatcher.dart =====
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

// ===== people_sdui_view.dart =====
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

// ===== settings_profile_header.dart =====
class SettingsProfileHeader extends StatelessWidget {
  final AppTheme theme;
  const SettingsProfileHeader({super.key, required this.theme});

  @override
  Widget build(BuildContext context) {
    return SliverToBoxAdapter(
      child: Container(
        margin: const EdgeInsets.all(20), padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [
            theme.gradientPrimary[0].withValues(alpha: 0.2),
            theme.gradientPrimary[1].withValues(alpha: 0.1),
          ]),
          borderRadius: BorderRadius.circular(theme.radiusLarge + 4),
          border: Border.all(color: theme.gradientPrimary[0].withValues(alpha: 0.3), width: 1),
        ),
        child: Row(children: [
          Container(
            width: 72, height: 72,
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: theme.gradientPrimary),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
            ),
            child: const Icon(Icons.person, color: Colors.white, size: 36),
          ),
          const SizedBox(width: 20),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Developer', style: TextStyle(color: theme.textPrimary, fontSize: 22, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text('ID: 88888888', style: TextStyle(color: theme.textTertiary, fontSize: 13)),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(10)),
              child: const Text('VIP', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ])),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium - 4)),
            child: Icon(Icons.qr_code, color: theme.textPrimary, size: 22),
          ),
        ]),
      ),
    );
  }
}

// ===== settings_theme_preview.dart =====
class SettingsThemePreview extends ConsumerWidget {
  final AppTheme previewTheme;
  final String name;

  const SettingsThemePreview({
    super.key,
    required this.previewTheme,
    required this.name,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentTheme = ref.watch(currentThemeProvider);
    final sel = previewTheme.style == currentTheme.style;
    final idx = AppTheme.all.indexWhere((t) => t.style == previewTheme.style);
    return GestureDetector(
      onTap: () { if (idx >= 0) ref.read(currentThemeIndexProvider.notifier).state = idx; },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200), padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: sel ? previewTheme.gradientPrimary[0].withValues(alpha: 0.1) : currentTheme.background,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: sel ? previewTheme.gradientPrimary[0] : currentTheme.textTertiary.withValues(alpha: 0.2),
            width: sel ? 2 : 1)),
        child: Row(children: [
          Row(children: [
            _colorDot(previewTheme.gradientPrimary[0]),
            _colorDot(previewTheme.gradientPrimary[1]),
            _colorDot(previewTheme.accent),
          ]),
          const SizedBox(width: 12),
          Expanded(child: Text(name, style: TextStyle(color: currentTheme.textPrimary, fontSize: 13,
            fontWeight: sel ? FontWeight.w600 : FontWeight.normal))),
          if (sel) Icon(Icons.check_circle, color: previewTheme.gradientPrimary[0], size: 20),
        ]),
      ),
    );
  }

  Widget _colorDot(Color c) => Container(
    margin: const EdgeInsets.only(right: 4), width: 16, height: 16,
    decoration: BoxDecoration(color: c, shape: BoxShape.circle,
      border: Border.all(color: Colors.white.withValues(alpha: 0.2), width: 1)),
  );
}

// ===== settings_theme_section.dart =====
class SettingsThemeSection extends ConsumerWidget {
  final AppTheme theme;
  final ThemeModeSetting themeMode;

  const SettingsThemeSection({
    super.key,
    required this.theme,
    required this.themeMode,
  });

  static const _modeLabels = {
    ThemeModeSetting.auto: '璺熼殢绯荤粺',
    ThemeModeSetting.light: '娴呰壊妯″紡',
    ThemeModeSetting.dark: '娣辫壊妯″紡',
    ThemeModeSetting.manual: '鎵嬪姩閫夋嫨',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return SliverToBoxAdapter(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
          child: Text('澶栬'.toUpperCase(), style: TextStyle(color: theme.textTertiary, fontSize: 11,
            fontWeight: FontWeight.w600, letterSpacing: 2)),
        ),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('涓婚妯″紡', style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
            const SizedBox(height: 12),
            Wrap(spacing: 8, runSpacing: 8, children: ThemeModeSetting.values.map((mode) {
              final sel = mode == themeMode;
              return GestureDetector(
                onTap: () => ref.read(themeModeProvider.notifier).state = mode,
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    gradient: sel ? LinearGradient(colors: theme.gradientPrimary) : null,
                    color: sel ? null : theme.background,
                    borderRadius: BorderRadius.circular(20),
                    border: sel ? null : Border.all(color: theme.textTertiary.withValues(alpha: 0.2), width: 1),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(_modeIcon(mode), color: sel ? Colors.white : theme.textSecondary, size: 16),
                    const SizedBox(width: 6),
                    Text(_modeLabels[mode]!, style: TextStyle(
                      color: sel ? Colors.white : theme.textSecondary, fontSize: 12,
                      fontWeight: sel ? FontWeight.w600 : FontWeight.normal)),
                  ]),
                ),
              );
            }).toList()),
          ]),
        ),
        if (themeMode == ThemeModeSetting.manual) ...[
          const SizedBox(height: 12),
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
              border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('閫夋嫨涓婚', style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w500)),
              const SizedBox(height: 12),
              for (final t in [
                {'theme': AppTheme.glassmorphism, 'name': 'Glass'},
                {'theme': AppTheme.minimalZen, 'name': 'Zen'},
                {'theme': AppTheme.natureOrganic, 'name': 'Nature'},
                {'theme': AppTheme.retroWave, 'name': 'Retro'},
                {'theme': AppTheme.corporatePro, 'name': 'Corporate'},
              ]) ...[
                SettingsThemePreview(previewTheme: t['theme'] as AppTheme, name: t['name'] as String),
                const SizedBox(height: 8),
              ],
            ]),
          ),
        ],
        const SizedBox(height: 8),
        Container(
          margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.gradientPrimary[0].withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(theme.radiusMedium),
            border: Border.all(color: theme.gradientPrimary[0].withValues(alpha: 0.3), width: 1)),
          child: Row(children: [
            Container(width: 40, height: 40,
              decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(10))),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('褰撳墠涓婚', style: TextStyle(color: theme.textSecondary, fontSize: 12)),
              const SizedBox(height: 2),
              Text(theme.name, style: TextStyle(color: theme.textPrimary, fontSize: 15, fontWeight: FontWeight.w600)),
            ])),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: theme.gradientPrimary[0].withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(8)),
              child: Text(_modeLabels[themeMode]!, style: TextStyle(color: theme.gradientPrimary[0],
                fontSize: 11, fontWeight: FontWeight.w500)),
            ),
          ]),
        ),
      ]),
    );
  }

  IconData _modeIcon(ThemeModeSetting mode) {
    switch (mode) {
      case ThemeModeSetting.auto: return Icons.brightness_auto;
      case ThemeModeSetting.light: return Icons.brightness_5;
      case ThemeModeSetting.dark: return Icons.brightness_2;
      case ThemeModeSetting.manual: return Icons.palette_outlined;
    }
  }
}

// ===== settings_hardcoded_view.dart =====
class SettingsHardcodedView extends StatelessWidget {
  final AppTheme theme;
  final ThemeModeSetting themeMode;

  const SettingsHardcodedView({
    super.key,
    required this.theme,
    required this.themeMode,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('SETTINGS',
          style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold,
            letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 2)),
        actions: [
          _buildActionButton(Icons.more_vert, theme), const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: CustomScrollView(
            slivers: [
              SettingsProfileHeader(theme: theme),
              SettingsThemeSection(theme: theme, themeMode: themeMode),
              _buildSection('General', [
                _buildSettingItem(Icons.language_outlined, 'Language', 'Chinese', theme.info, theme),
                _buildSettingItem(Icons.notifications_outlined, 'Notifications', 'Enabled', theme.success, theme),
              ], theme),
              _buildSection('Account', [
                _buildSettingItem(Icons.person_outlined, 'Profile', '', theme.gradientPrimary[0], theme),
                _buildSettingItem(Icons.security_outlined, 'Security', '', theme.warning, theme),
                _buildSettingItem(Icons.link_outlined, 'Linked Accounts', '', theme.accent, theme),
              ], theme),
              _buildSection('Connection', [
                BridgeUrlTile(theme: theme),
              ], theme),
              _buildSection('Other', [
                _buildSettingItem(Icons.storage_outlined, 'Storage', '2.4 GB', theme.gradientAccent[0], theme),
                _buildSettingItem(Icons.help_outline, 'Help', '', theme.gradientAccent[1], theme),
                _buildSettingItem(Icons.info_outlined, 'About', 'v1.0.0', theme.textSecondary, theme),
              ], theme),
              const SliverPadding(padding: EdgeInsets.only(bottom: 100)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildActionButton(IconData icon, AppTheme theme) {
    return Container(
      margin: const EdgeInsets.only(right: 8), padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusMedium),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1),
      ),
      child: Icon(icon, color: theme.textSecondary, size: 20),
    );
  }

  Widget _buildSection(String title, List<Widget> items, AppTheme theme) {
    return SliverToBoxAdapter(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Padding(padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
        child: Text(title.toUpperCase(), style: TextStyle(color: theme.textTertiary, fontSize: 11,
          fontWeight: FontWeight.w600, letterSpacing: 2))),
      ...items,
    ]));
  }

  Widget _buildSettingItem(IconData icon, String title, String value, Color color, AppTheme theme, {VoidCallback? onTap}) {
    return ListTile(
      leading: Container(
        width: 40, height: 40,
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(10)),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 15)),
      subtitle: value.isNotEmpty ? Text(value, style: TextStyle(color: theme.textSecondary, fontSize: 12)) : null,
      trailing: Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
      onTap: onTap,
    );
  }
}

// ===== settings_sdui_view.dart =====
IconData _sduiIcon(String name) => SduiParser.icons[name] ?? Icons.circle_outlined;

class SettingsSduiView extends StatelessWidget {
  final Map<String, dynamic> layout;
  final AppTheme theme;
  final void Function(String action) onAction;

  const SettingsSduiView({
    super.key,
    required this.layout,
    required this.theme,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    final sections = layout['sections'] as List;
    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(layout['title'] as String? ?? 'SETTINGS',
          style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold)),
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: ListView(
            children: [
              for (final sec in sections) ...[
                if (sec is Map) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
                    child: Text((sec['title'] as String? ?? '').toUpperCase(),
                      style: TextStyle(color: theme.textTertiary, fontSize: 11,
                        fontWeight: FontWeight.w600, letterSpacing: 2)),
                  ),
                  if (sec['items'] is List)
                    for (final item in sec['items'])
                      if (item is Map) _buildItem(theme, item),
                ],
              ],
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                child: Text('鐗堟湰: $appVersion',
                  style: TextStyle(color: theme.textTertiary, fontSize: 11)),
              ),
              const Padding(padding: EdgeInsets.only(bottom: 100)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildItem(AppTheme theme, Map item) {
    final iconName = item['icon'] as String?;
    final label = item['label'] as String? ?? '';
    final value = item['value'] as String?;
    final action = item['action'] as String?;
    final colorStr = item['color'] as String?;
    final color = colorStr != null
        ? Color(int.parse(colorStr.replaceAll('#', '0xFF')))
        : theme.gradientPrimary[0];
    return ListCard(
      leading: iconName != null ? Icon(_sduiIcon(iconName), color: color, size: 20) : null,
      leadingColor: color,
      title: label,
      subtitle: value,
      onTap: action != null ? () => onAction(action) : null,
      trailing: Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
    );
  }
}

