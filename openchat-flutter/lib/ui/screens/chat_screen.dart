import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:async';
import 'dart:developer' show log;
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../providers/bridge_provider.dart';
import '../../core/api/bridge_ws_client.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';
import 'chat_voice_recorder.dart';
import 'chat_voice_player.dart';

final bridgeWsProvider = Provider<BridgeWsClient>((ref) {
  final client = BridgeWsClient(port: 3800);
  client.connect();
  ref.onDispose(() => client.dispose());
  return client;
});

class ChatScreen extends ConsumerStatefulWidget {
  final String chatId;
  final String title;
  const ChatScreen({super.key, required this.chatId, required this.title});

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> with SduiPageState {
  final TextEditingController _controller = TextEditingController();
  final List<Map<String, dynamic>> _messages = [];
  final ScrollController _scrollController = ScrollController();
  StreamSubscription? _wsSub;
  final _recorder = ChatVoiceRecorder();
  final _player = ChatVoicePlayer();
  bool _vmRecording = false;

  @override
  String get sduiPage => 'chat';

  @override
  void initState() {
    super.initState();
    _messages.addAll([
      {'sender': 'ai', 'type': 'text', 'text': 'Hello! How can I help you?', 'time': '10:00'},
    ]);
    _wsSub = ref.read(bridgeWsProvider).messages.listen((msg) {
      if (msg.type == 'chat_chunk' || msg.type == 'chat_response') {
        final content = msg.data['content'] as String? ?? msg.data['text'] as String? ?? '';
        if (content.isNotEmpty) setState(() {
          _messages.add({'sender': 'ai', 'type': 'text', 'text': content, 'time': DateTime.now().toString().substring(11, 16)});
        });
      }
      if (msg.type == 'voice_msg') {
        final key = msg.data['key'] as String?;
        if (key != null) { setState(() {
          _messages.add({'sender': 'ai', 'type': 'voice', 'key': key, 'time': DateTime.now().toString().substring(11, 16)});
          log('[C13] received voice_msg key=$key');
        }); }
      }
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    _controller.dispose();
    _scrollController.dispose();
    _recorder.dispose();
    _player.dispose();
    super.dispose();
  }

  void _sendText() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _messages.add({'sender': 'me', 'type': 'text', 'text': text, 'time': DateTime.now().toString().substring(11, 16)});
    });
    _controller.clear();
    ref.read(bridgeWsProvider).sendMessage(text, sessionId: widget.chatId);
    _scrollBottom();
  }

  void _startVmRecord() async {
    final ok = await _recorder.startRecord();
    if (ok && mounted) setState(() => _vmRecording = true);
  }

  void _endVmRecord() async {
    final key = await _recorder.stopRecord(chatId: widget.chatId);
    if (key != null) {
      ref.read(bridgeWsProvider).sendJson({
        'type': 'voice_msg', 'data': {'key': key, 'sessionId': widget.chatId},
      });
      log('[C13] ws sent voice_msg key=$key');
      if (mounted) setState(() {
        _messages.add({'sender': 'me', 'type': 'voice', 'key': key, 'time': DateTime.now().toString().substring(11, 16)});
      });
    }
    if (mounted) setState(() => _vmRecording = false);
    _scrollBottom();
  }

  void _playVoiceMsg(String key) {
    _player.playKey(key);
  }

  void _scrollBottom() {
    Future.delayed(const Duration(milliseconds: 100), () {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300), curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final title = sduiLayout['title'] as String? ?? widget.title;

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surface.withValues(alpha: 0.5),
        elevation: 0,
        title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 18, fontWeight: FontWeight.w600)),
        actions: [
          IconButton(icon: Icon(sduiLayout['callIcon'] == null ? Icons.phone_outlined : (SduiParser.icons[sduiLayout['callIcon']] ?? Icons.phone_outlined), color: theme.textSecondary), onPressed: () {}),
          IconButton(icon: Icon(Icons.videocam_outlined, color: theme.textSecondary), onPressed: () {}),
          IconButton(icon: Icon(Icons.more_vert, color: theme.textSecondary), onPressed: () {}),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          Expanded(child: _messages.isEmpty
            ? _buildEmptyState(theme)
            : () {
              final msgItems = _messages.map((m) => {
                'text': m['text'] ?? '',
                'time': m['time'] ?? '',
                'isMe': (m['sender'] == 'me').toString(),
              }).toList();
              final msgLayout = sduiLayout['messageLayout'] as Map?;
              if (msgLayout != null) {
                final parser = SduiParser(onAction: null, vars: {'items': msgItems, 'selfBg': (sduiLayout['bubble'] as Map?)?['selfColor'] ?? '#7C4DFF', 'otherBg': (sduiLayout['bubble'] as Map?)?['otherColor'] ?? '#333333'});
                final widget = parser.parse(msgLayout);
                if (widget != null) {
                  return SingleChildScrollView(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    child: widget,
                  );
                }
              }
              return ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(16),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) => _buildBubble(_messages[index], theme));
            }()),
          _buildInputArea(theme),
        ],
      ),
    );
  }

  Widget _buildEmptyState(AppTheme theme) {
    final es = sduiLayout['emptyState'] as Map?;
    if (es == null) return const SizedBox();
    final parser = SduiParser(vars: {}, onAction: null);
    return Center(child: parser.parse({
      'type': 'column', 'center': true, 'children': [
        {'type': 'padding', 'padding': 32, 'child': {'type': 'icon', 'icon': es['icon'] ?? 'chat', 'size': 64}},
        if (es['title'] != null) {'type': 'text', 'content': es['title'], 'style': {'size': 16}, 'pad': 8},
        if (es['subtitle'] != null) {'type': 'text', 'content': es['subtitle'], 'style': {'size': 13, 'color': '#9E9E9E'}},
      ],
    }));
  }

  Widget _buildBubble(Map<String, dynamic> message, AppTheme theme) {
    final isMe = message['sender'] == 'me';
    final isVoice = message['type'] == 'voice';
    final bc = sduiLayout['bubble'] as Map? ?? {};
    final selfColor = bc['selfColor'] as String?;
    final otherColor = bc['otherColor'] as String?;
    final radius = (bc['radius'] as num?)?.toDouble() ?? 20;
    final selfBg = selfColor != null ? Color(int.parse(selfColor.replaceAll('#', '0xFF'))) : null;
    final otherBg = otherColor != null ? Color(int.parse(otherColor.replaceAll('#', '0xFF'))) : null;
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          gradient: isMe && selfBg == null ? LinearGradient(colors: theme.gradientPrimary) : null,
          color: isMe ? selfBg : (otherBg ?? theme.surface.withValues(alpha: 0.5)),
          borderRadius: BorderRadius.circular(radius).copyWith(
            bottomRight: isMe ? const Radius.circular(4) : null,
            bottomLeft: !isMe ? const Radius.circular(4) : null,
          ),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (!isVoice)
            Text(message['text'] ?? '', style: TextStyle(color: isMe ? Colors.white : theme.textPrimary, fontSize: 14))
          else
            GestureDetector(
              onTap: () => _playVoiceMsg(message['key'] as String),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.play_arrow, color: isMe ? Colors.white : theme.primary, size: 20),
                const SizedBox(width: 6),
                Text('语音', style: TextStyle(color: isMe ? Colors.white : theme.textPrimary, fontSize: 14)),
              ]),
            ),
          const SizedBox(height: 4),
          Text(message['time'] ?? '', style: TextStyle(color: isMe ? Colors.white.withValues(alpha: 0.7) : theme.textTertiary, fontSize: 10)),
        ]),
      ),
    );
  }

  Widget _buildInputArea(AppTheme theme) {
    final ia = sduiLayout['input'] as Map? ?? {};
    final hint = ia['hint'] as String? ?? '输入消息...';
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        border: Border(top: BorderSide(color: theme.textTertiary.withValues(alpha: 0.1), width: 1))),
      child: SafeArea(child: Row(children: [
        IconButton(icon: Icon(Icons.add_circle_outline, color: theme.textSecondary), onPressed: () {}),
        Expanded(child: TextField(
          controller: _controller,
          style: TextStyle(color: theme.textPrimary),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: theme.textTertiary),
            filled: true, fillColor: theme.background,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
          onSubmitted: (_) => _sendText(),
        )),
        IconButton(icon: Icon(Icons.emoji_emotions_outlined, color: theme.textSecondary), onPressed: () {}),
        Listener(
          onPointerDown: (_) => _startVmRecord(),
          onPointerUp: (_) => _endVmRecord(),
          onPointerCancel: () => _endVmRecord(),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: _vmRecording ? theme.error.withValues(alpha: 0.3) : null,
              gradient: _vmRecording ? null : LinearGradient(colors: theme.gradientPrimary),
              borderRadius: BorderRadius.circular(20)),
            child: Icon(_vmRecording ? Icons.mic : Icons.keyboard_voice, color: Colors.white, size: 20)),
        ),
      ])),
    );
  }
}
