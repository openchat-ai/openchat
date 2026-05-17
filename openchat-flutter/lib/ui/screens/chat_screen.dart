import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:async';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../providers/bridge_provider.dart';
import '../../core/api/bridge_ws_client.dart';

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

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final List<Map<String, dynamic>> _messages = [];
  final ScrollController _scrollController = ScrollController();
  StreamSubscription? _wsSub;

  @override
  void initState() {
    super.initState();
    _messages.addAll([
      {'sender': 'ai', 'text': '你好！有什么可以帮助你的？', 'time': '10:00'},
    ]);
    _wsSub = ref.read(bridgeWsProvider).messages.listen((msg) {
      if (msg.type == 'chat_chunk' || msg.type == 'chat_response') {
        setState(() {
          final content = msg.data['content'] as String? ?? msg.data['text'] as String? ?? '';
          if (content.isNotEmpty) {
            _messages.add({'sender': 'ai', 'text': content, 'time': DateTime.now().toString().substring(11, 16)});
          }
        });
      }
    });
  }

  @override
  void dispose() {
    _wsSub?.cancel();
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surface.withValues(alpha: 0.5),
        elevation: 0,
        title: Text(
          widget.title,
          style: TextStyle(
            color: theme.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.phone_outlined, color: theme.textSecondary),
            onPressed: () {},
          ),
          IconButton(
            icon: Icon(Icons.videocam_outlined, color: theme.textSecondary),
            onPressed: () {},
          ),
          IconButton(
            icon: Icon(Icons.more_vert, color: theme.textSecondary),
            onPressed: () {},
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16),
              itemCount: _messages.length,
              itemBuilder: (context, index) => _buildMessage(_messages[index], theme),
            ),
          ),
          _buildInputArea(theme),
        ],
      ),
    );
  }

  Widget _buildMessage(Map<String, dynamic> message, AppTheme theme) {
    final isMe = message['sender'] == 'me';
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          gradient: isMe ? LinearGradient(colors: theme.gradientPrimary) : null,
          color: isMe ? null : theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(20).copyWith(
            bottomRight: isMe ? const Radius.circular(4) : null,
            bottomLeft: !isMe ? const Radius.circular(4) : null,
          ),
          boxShadow: isMe && theme.useGlow ? [
            BoxShadow(
              color: theme.primary.withValues(alpha: 0.3),
              blurRadius: 10,
              spreadRadius: 1,
            ),
          ] : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message['text'],
              style: TextStyle(
                color: isMe ? Colors.white : theme.textPrimary,
                fontSize: 14,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              message['time'],
              style: TextStyle(
                color: isMe ? Colors.white.withValues(alpha: 0.7) : theme.textTertiary,
                fontSize: 10,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInputArea(AppTheme theme) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        border: Border(
          top: BorderSide(
            color: theme.textTertiary.withValues(alpha: 0.1),
            width: 1,
          ),
        ),
      ),
      child: SafeArea(
        child: Row(
          children: [
            IconButton(
              icon: Icon(Icons.add_circle_outline, color: theme.textSecondary),
              onPressed: () {},
            ),
            Expanded(
              child: TextField(
                controller: _controller,
                style: TextStyle(color: theme.textPrimary),
                decoration: InputDecoration(
                  hintText: '输入消息...',
                  hintStyle: TextStyle(color: theme.textTertiary),
                  filled: true,
                  fillColor: theme.background,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                ),
                onSubmitted: (_) => _sendMessage(),
              ),
            ),
            IconButton(
              icon: Icon(Icons.emoji_emotions_outlined, color: theme.textSecondary),
              onPressed: () {},
            ),
            GestureDetector(
              onTap: _sendMessage,
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: theme.gradientPrimary),
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: theme.useGlow ? [
                    BoxShadow(
                      color: theme.primary.withValues(alpha: 0.4),
                      blurRadius: 10,
                      spreadRadius: 1,
                    ),
                  ] : null,
                ),
                child: const Icon(Icons.send, color: Colors.white, size: 20),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _sendMessage() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;

    setState(() {
      _messages.add({
        'sender': 'me',
        'text': text,
        'time': DateTime.now().toString().substring(11, 16),
      });
    });
    _controller.clear();

    // 通过 WebSocket 发送到 Bridge
    ref.read(bridgeWsProvider).sendMessage(text, sessionId: widget.chatId);

    // Scroll to bottom
    Future.delayed(const Duration(milliseconds: 100), () {
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    });

    // 模拟回复
    Future.delayed(const Duration(seconds: 1), () {
      setState(() {
        _messages.add({
          'sender': 'ai',
          'text': '收到你的消息：text',
          'time': DateTime.now().toString().substring(11, 16),
        });
      });
    });
  }
}
