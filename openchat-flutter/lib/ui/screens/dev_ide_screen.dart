import 'package:flutter/material.dart';
import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../providers/bridge_provider.dart';
import '../../core/api/bridge_ws_client.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';
import '../../core/version.dart';

class DevIdeScreen extends ConsumerStatefulWidget {
  const DevIdeScreen({super.key});
  @override
  ConsumerState<DevIdeScreen> createState() => _DevIdeScreenState();
}

class _DevIdeScreenState extends ConsumerState<DevIdeScreen> with SduiPageState {
  @override
  String get sduiPage => 'dev_ide';
  int _tab = 0;
  final List<Map<String, String>> _logs = [];
  final TextEditingController _cmdController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _logs.insert(0, {'type': 'info', 'text': 'Dev Console ready'});
    _logs.insert(0, {'type': 'info', 'text': 'Type a command or use Test tab'});
  }

  @override
  void dispose() {
    _cmdController.dispose();
    super.dispose();
  }

  void _execDebug(String action) {
    setState(() => _logs.insert(0, {'type': 'cmd', 'text': '> $action'}));
    if (action == 'self_test') {
      Navigator.pushNamed(context, '/voice', arguments: {
        'selfTest': 'true',
        'targetPeerId': 'self',
        'client': null,
      });
      return;
    }
    if (action == 'audio_files') {
      setState(() => _logs.insert(0, {'type': 'info', 'text': 'Audio files: not available without Qiniu client'}));
      return;
    }
    Future.delayed(const Duration(milliseconds: 500), () {
      if (mounted) setState(() => _logs.insert(0, {'type': 'result', 'text': 'ok: $action'}));
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final bridge = ref.watch(bridgeWsProvider);
    final tabs = sduiLayout['tabs'] as List? ?? [];

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surface.withValues(alpha: 0.5), elevation: 0,
        title: Text(sduiLayout['title'] as String? ?? 'Dev Console',
          style: TextStyle(color: theme.textPrimary, fontFamily: 'monospace', fontSize: 17)),
      ),
      body: Column(children: [
        if (tabs.isNotEmpty)
          Container(
            height: 40, margin: const EdgeInsets.symmetric(horizontal: 12),
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: tabs.length,
              itemBuilder: (_, i) {
                final tab = tabs[i] as Map? ?? {};
                final label = tab['label'] as String? ?? 'Tab $i';
                final sel = i == _tab;
                return GestureDetector(
                  onTap: () => setState(() => _tab = i),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    margin: const EdgeInsets.only(right: 8),
                    decoration: BoxDecoration(
                      color: sel ? theme.primary.withValues(alpha: 0.2) : Colors.transparent,
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(label, style: TextStyle(
                      color: sel ? theme.primary : theme.textSecondary, fontSize: 13,
                      fontWeight: sel ? FontWeight.w600 : FontWeight.normal)),
                  ),
                );
              },
            ),
          ),
        Expanded(child: _buildTabContent(theme, bridge)),
        _buildDebugInput(theme),
      ]),
    );
  }

  Widget _buildTabContent(AppTheme theme, BridgeWsClient bridge) {
    final tabs = sduiLayout['tabs'] as List? ?? [];
    if (_tab >= tabs.length) return const SizedBox();
    final tab = tabs[_tab] as Map? ?? {};
    final type = tab['type'] as String? ?? 'sdui';
    final content = tab['content'] as Map?;

    if (type == 'sdui' && content != null) {
      final parser = SduiParser(onAction: (a) {
        if (a == 'refresh_logs') setState(() => _logs.insert(0, {'type': 'info', 'text': 'Logs refreshed'}));
        else if (a == 'clear_logs') setState(() => _logs.clear());
        else if (a.startsWith('exec_cmd:')) _execDebug(a.substring(9));
        else _execDebug(a);
      }, vars: {
        'peerId': bridge.peerId ?? '?',
        'appVersion': appVersion,
        'logCount': _logs.length,
      });
      return parser.parse(content) ?? const SizedBox();
    }

    if (type == 'logs') {
      return _logs.isEmpty
          ? Center(child: Text('No logs', style: TextStyle(color: theme.textTertiary, fontSize: 14)))
          : ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: _logs.length,
              itemBuilder: (_, i) {
                final log = _logs[i];
                final isCmd = log['type'] == 'cmd';
                final isResult = log['type'] == 'result';
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Text(log['text'] ?? '',
                    style: TextStyle(
                      color: isCmd ? theme.primary : (isResult ? theme.success : theme.textSecondary),
                      fontFamily: 'monospace', fontSize: 12)),
                );
              },
            );
    }

    return Center(child: Text('Unknown tab type: $type', style: TextStyle(color: theme.textTertiary)));
  }

  Widget _buildDebugInput(AppTheme theme) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        border: Border(top: BorderSide(color: theme.textTertiary.withValues(alpha: 0.1)))),
      child: Row(children: [
        Expanded(child: TextField(
          controller: _cmdController,
          style: TextStyle(color: theme.textPrimary, fontFamily: 'monospace', fontSize: 13),
          decoration: InputDecoration(
            hintText: 'debug command (ping / diag / test_put / test_list)',
            hintStyle: TextStyle(color: theme.textTertiary, fontSize: 12),
            filled: true, fillColor: theme.background,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8)),
          onSubmitted: (v) { _execDebug(v.trim()); _cmdController.clear(); },
        )),
        const SizedBox(width: 8),
        GestureDetector(
          onTap: () { _execDebug(_cmdController.text.trim()); _cmdController.clear(); },
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary), borderRadius: BorderRadius.circular(16)),
            child: const Icon(Icons.send, color: Colors.white, size: 18)),
        ),
      ]),
    );
  }
}
