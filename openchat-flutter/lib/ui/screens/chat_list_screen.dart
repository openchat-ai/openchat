import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:async';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../providers/bridge_provider.dart';
import '../../core/api/base_client.dart';
import '../../core/sdui_config.dart';
import '../../core/sdui_config.dart';
import 'chat_screen.dart' hide bridgeWsProvider;

class ChatListScreen extends ConsumerStatefulWidget {
  const ChatListScreen({super.key});
  @override
  ConsumerState<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends ConsumerState<ChatListScreen> with SduiPageState {
  @override
  String get sduiPage => 'chat_list';
  StreamSubscription? _wsSub;
  final List<Map<String, dynamic>> _messages = [];

  @override
  void initState() {
    super.initState();
    _wsSub = ref.read(bridgeWsProvider).messages.listen((msg) {
      if (msg.type == 'message' && msg.data['message'] != null) {
        setState(() => _messages.insert(0, {'text': msg.data['message'], 'from': msg.data['from'] ?? 'peer'}));
      }
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    super.dispose();
  }

  void _handleAction(String action) {
    if (action == 'open_chat') {
      Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(chatId: 'bridge', title: 'AI Chat')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final bridge = ref.watch(bridgeWsProvider);
    final connection = ref.watch(bridgeConnectionProvider);

    final connected = connection.when(
      data: (info) => info.state == WsConnectionState.connected,
      error: (_, __) => false,
      loading: () => false,
    );

    if (sduiLayout.isNotEmpty) {
      final selected = sduiLayout['layout'] as Map?;
      if (selected != null) {
        final parser = SduiParser(
          onAction: _handleAction,
          vars: {
            'connected': connected,
            'connectedText': connected ? 'Connected' : 'Offline',
            'connectedColor': connected ? '#4CAF50' : '#F44336',
            'peerId': bridge.peerId ?? 'connecting...',
            'messageCount': _messages.length,
            'emptyText': 'No messages yet\nSend a message to start',
          },
        );
        final widget = parser.parse(selected);
        if (widget != null) {
          return Scaffold(
            backgroundColor: theme.background,
            body: SafeArea(child: widget),
          );
        }
      }
    }

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text('MESSAGES', style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold)),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: connected ? Colors.green.withValues(alpha: 0.2) : Colors.red.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(Icons.circle, size: 8, color: connected ? Colors.green : Colors.red),
              const SizedBox(width: 4),
              Text(connected ? 'Connected' : 'Offline', style: TextStyle(fontSize: 11, color: connected ? Colors.green : Colors.red)),
            ]),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(children: [
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: theme.surface, borderRadius: BorderRadius.circular(12)),
            child: Row(children: [
              Icon(Icons.wifi, color: theme.textSecondary, size: 18),
              const SizedBox(width: 8),
              Expanded(child: Text('Peer: ${bridge.peerId ?? "connecting..."}', style: TextStyle(color: theme.textSecondary, fontSize: 12))),
              IconButton(
                icon: Icon(Icons.send, color: theme.primary, size: 20),
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(chatId: 'bridge', title: 'AI Chat'))),
              ),
            ]),
          ),
          Expanded(
            child: _messages.isEmpty
              ? Center(child: Text('No messages yet\nSend a message to start', textAlign: TextAlign.center, style: TextStyle(color: theme.textTertiary)))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _messages.length,
                  itemBuilder: (_, i) => ListTile(
                    leading: Icon(Icons.person, color: theme.primary),
                    title: Text(_messages[i]['text'] ?? '', style: TextStyle(color: theme.textPrimary)),
                    subtitle: Text(_messages[i]['from'] ?? '', style: TextStyle(color: theme.textTertiary, fontSize: 11)),
                  ),
                ),
          ),
        ]),
      ),
    );
  }
}
