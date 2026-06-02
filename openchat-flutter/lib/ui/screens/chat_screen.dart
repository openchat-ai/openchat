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
import 'chat_bubble.dart';
import 'chat_input_area.dart';
import 'chat_empty_state.dart';

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
            ? ChatEmptyState(theme: theme, layout: sduiLayout)
            : _buildMessageList(theme)),
          ChatInputArea(
            theme: theme,
            controller: _controller,
            layout: sduiLayout,
            recording: _vmRecording,
            onSend: _sendText,
            onStartRecord: _startVmRecord,
            onEndRecord: _endVmRecord,
          ),
        ],
      ),
    );
  }

  Widget _buildMessageList(AppTheme theme) {
    final msgLayout = sduiLayout['messageLayout'] as Map?;
    if (msgLayout != null) {
      final msgItems = _messages.map((m) => {
        'text': m['text'] ?? '',
        'time': m['time'] ?? '',
        'isMe': (m['sender'] == 'me').toString(),
      }).toList();
      final parser = SduiParser(onAction: null, vars: {
        'items': msgItems,
        'selfBg': (sduiLayout['bubble'] as Map?)?['selfColor'] ?? '#7C4DFF',
        'otherBg': (sduiLayout['bubble'] as Map?)?['otherColor'] ?? '#333333',
      });
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
        itemBuilder: (context, index) => ChatBubble(
          message: _messages[index],
          theme: theme,
          layout: sduiLayout,
          onPlayVoice: () => _playVoiceMsg(_messages[index]['key'] as String),
        ));
  }
}
