import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import 'package:openchat/models/message.dart';
import 'package:openchat/providers/identity_provider.dart';
import 'package:openchat/providers/messages_provider.dart';
import 'package:openchat/providers/bridge_provider.dart';
import 'package:openchat/services/bridge_service.dart';
import 'package:openchat/ui/theme/colors.dart';

class ChatDetailScreen extends ConsumerStatefulWidget {
  final String id;
  final String name;

  const ChatDetailScreen({
    super.key,
    required this.id,
    required this.name,
  });

  @override
  ConsumerState<ChatDetailScreen> createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends ConsumerState<ChatDetailScreen> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();
  bool _isLoading = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _checkBridgeConnection();
  }

  Future<void> _checkBridgeConnection() async {
    final isConnected = ref.read(bridgeConnectionProvider);
    if (!isConnected) {
      await ref.read(bridgeConnectionProvider.notifier).connect();
    }
  }

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty || _isLoading) return;

    final identity = ref.read(identityProvider);
    if (identity == null) return;

    final message = Message(
      id: const Uuid().v4(),
      senderId: identity.id,
      receiverId: widget.id,
      content: text,
      timestamp: DateTime.now(),
      isSent: true,
    );

    ref.read(messagesProvider.notifier).addMessage(widget.id, message);
    _messageController.clear();
    _scrollToBottom();

    await _sendToBridge(text);
  }

  Future<void> _sendToBridge(String userMessage) async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final bridgeService = ref.read(bridgeServiceProvider);
      final isConnected = ref.read(bridgeConnectionProvider);

      if (!isConnected) {
        final connected = await ref.read(bridgeConnectionProvider.notifier).connect();
        if (!connected) {
          setState(() {
            _errorMessage = '无法连接到 Bridge 服务。请确保 Bridge 正在运行。';
            _isLoading = false;
          });
          return;
        }
      }

      final streamMessageId = const Uuid().v4();
      final streamMessage = Message(
        id: streamMessageId,
        senderId: widget.id,
        receiverId: ref.read(identityProvider)?.id ?? '',
        content: '',
        timestamp: DateTime.now(),
        isSent: true,
        isDelivered: false,
      );

      ref.read(messagesProvider.notifier).addMessage(widget.id, streamMessage);

      final stream = bridgeService.sendMessageStream(userMessage);
      final fullContent = StringBuffer();

      await for (final event in stream) {
        switch (event.type) {
          case StreamEventType.content:
            fullContent.write(event.content);
            _updateStreamMessage(streamMessageId, fullContent.toString());
            break;

          case StreamEventType.complete:
            final finalContent = event.content ?? fullContent.toString();
            _updateStreamMessage(streamMessageId, finalContent, delivered: true);
            break;

          case StreamEventType.error:
            setState(() {
              _errorMessage = event.error ?? '未知错误';
            });
            ref.read(messagesProvider.notifier).removeMessage(widget.id, streamMessageId);
            break;

          case StreamEventType.session:
            break;

          case StreamEventType.thinking:
          case StreamEventType.toolCall:
          case StreamEventType.toolResult:
            break;
        }
      }

      _scrollToBottom();
    } catch (e) {
      setState(() {
        _errorMessage = '发送失败: $e';
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  void _updateStreamMessage(String messageId, String content, {bool delivered = false}) {
    final messages = ref.read(messagesProvider);
    final chatMessages = messages[widget.id] ?? [];

    final oldMessage = chatMessages.firstWhere(
      (m) => m.id == messageId,
      orElse: () => throw StateError('Message not found'),
    );

    final updatedMessage = Message(
      id: oldMessage.id,
      senderId: oldMessage.senderId,
      receiverId: oldMessage.receiverId,
      content: content,
      timestamp: oldMessage.timestamp,
      isSent: true,
      isDelivered: delivered,
    );

    ref.read(messagesProvider.notifier).updateMessage(widget.id, updatedMessage);
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final messages = ref.watch(chatMessagesProvider(widget.id));
    final identity = ref.watch(identityProvider);

    return Scaffold(
      backgroundColor: AppColors.backgroundDark,
      appBar: AppBar(
        backgroundColor: AppColors.surfaceDark,
        title: Row(
          children: [
            CircleAvatar(
              radius: 18,
              backgroundColor: AppColors.primary,
              child: Text(
                widget.name.isNotEmpty ? widget.name[0].toUpperCase() : '?',
                style: const TextStyle(color: Colors.white, fontSize: 14),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.name, style: const TextStyle(fontSize: 16)),
                  const Text(
                    'Online',
                    style: TextStyle(
                      fontSize: 12,
                      color: AppColors.success,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(icon: const Icon(Icons.more_vert), onPressed: () {}),
        ],
      ),
      body: Column(
        children: [
          Consumer(
            builder: (context, ref, _) {
              final isConnected = ref.watch(bridgeConnectionProvider);
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                color: isConnected
                    ? AppColors.success.withAlpha(30)
                    : AppColors.error.withAlpha(30),
                child: Row(
                  children: [
                    Icon(
                      isConnected ? Icons.check_circle : Icons.error_outline,
                      size: 14,
                      color: isConnected ? AppColors.success : AppColors.error,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      isConnected ? '已连接 Bridge' : '未连接 Bridge',
                      style: TextStyle(
                        fontSize: 12,
                        color: isConnected ? AppColors.success : AppColors.error,
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
          if (_errorMessage != null)
            Container(
              padding: const EdgeInsets.all(8),
              color: AppColors.error.withAlpha(30),
              child: Row(
                children: [
                  const Icon(Icons.error_outline, size: 16, color: AppColors.error),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _errorMessage!,
                      style: const TextStyle(fontSize: 12, color: AppColors.error),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close, size: 16, color: AppColors.error),
                    onPressed: () => setState(() => _errorMessage = null),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ],
              ),
            ),
          Expanded(
            child: messages.isEmpty
                ? Center(
                    child: Text(
                      'No messages yet',
                      style: TextStyle(
                        color: AppColors.textSecondary.withAlpha(128),
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.all(16),
                    itemCount: messages.length + (_isLoading ? 1 : 0),
                    itemBuilder: (context, index) {
                      if (index == messages.length && _isLoading) {
                        return const Align(
                          alignment: Alignment.centerLeft,
                          child: Padding(
                            padding: EdgeInsets.all(16),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: AppColors.primary,
                                  ),
                                ),
                                SizedBox(width: 8),
                                Text(
                                  'AI 正在思考...',
                                  style: TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      }

                      final message = messages[index];
                      final isMe = message.senderId == identity?.id;
                      return _MessageBubble(message: message, isMe: isMe);
                    },
                  ),
          ),
          _buildInputBar(),
        ],
      ),
    );
  }

  Widget _buildInputBar() {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(
        color: AppColors.surfaceDark,
        border: Border(top: BorderSide(color: AppColors.dividerDark)),
      ),
      child: SafeArea(
        child: Row(
          children: [
            IconButton(
              icon: const Icon(Icons.add, color: AppColors.textSecondary),
              onPressed: _isLoading ? null : () {},
            ),
            Expanded(
              child: TextField(
                controller: _messageController,
                style: const TextStyle(color: Colors.white),
                enabled: !_isLoading,
                decoration: InputDecoration(
                  hintText: _isLoading ? '等待 AI 响应...' : 'Type a message...',
                  hintStyle: const TextStyle(color: AppColors.textSecondary),
                  filled: true,
                  fillColor: AppColors.backgroundDark,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(24),
                    borderSide: BorderSide.none,
                  ),
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                ),
                onSubmitted: _isLoading ? null : (_) => _sendMessage(),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              icon: _isLoading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.primary,
                      ),
                    )
                  : const Icon(Icons.send, color: AppColors.primary),
              onPressed: _isLoading ? null : _sendMessage,
            ),
          ],
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final Message message;
  final bool isMe;

  const _MessageBubble({required this.message, required this.isMe});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        decoration: BoxDecoration(
          color: isMe ? AppColors.primary : AppColors.surfaceDark,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: isMe ? const Radius.circular(16) : Radius.zero,
            bottomRight: isMe ? Radius.zero : const Radius.circular(16),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(message.content, style: const TextStyle(color: Colors.white)),
            const SizedBox(height: 4),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _formatTime(message.timestamp),
                  style: TextStyle(
                    fontSize: 10,
                    color: Colors.white.withAlpha(179),
                  ),
                ),
                if (isMe) ...[
                  const SizedBox(width: 4),
                  Icon(
                    message.isDelivered ? Icons.done_all : Icons.done,
                    size: 12,
                    color: message.isDelivered
                        ? AppColors.success
                        : Colors.white.withAlpha(179),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _formatTime(DateTime time) {
    return '${time.hour.toString().padLeft(2, '0')}:${time.minute.toString().padLeft(2, '0')}';
  }
}
