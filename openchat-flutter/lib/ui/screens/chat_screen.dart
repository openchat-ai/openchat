import 'dart:async';
import 'dart:convert';
import 'dart:developer' show log;
import 'dart:math' show min;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/api/qiniu_client.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import 'chat_bubble.dart';
import 'chat_empty_state.dart';
import 'chat_input_area.dart';
import 'chat_voice_player.dart';
import 'chat_voice_recorder.dart';

// === invariants ===
// - All communication with Bridge is via Qiniu (no WebSocket, no IP)
// - _replyPollTimer cancels in dispose() to prevent leaks
// - _seenReplyKeys persists in memory only; _startupTs filters historical replies
// - QiniuDirectClient is shared between recorder/player/poll loop via this screen
//   (recorder + player have their own internal clients; this one is for polling only)

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
  final _recorder = ChatVoiceRecorder();
  final _player = ChatVoicePlayer();
  QiniuDirectClient? _qiniu;
  Timer? _replyPollTimer;
  final Set<String> _seenReplyKeys = {};
  bool _vmRecording = false;
  int _startupTs = 0;

  @override
  String get sduiPage => 'chat';

  @override
  void initState() {
    super.initState();
    _startupTs = DateTime.now().millisecondsSinceEpoch;
    _messages.add({'sender': 'ai', 'type': 'text', 'text': 'Hello! How can I help you?', 'time': '10:00'});
    _initQiniuPoll();
  }

  Future<void> _initQiniuPoll() async {
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'chat_${DateTime.now().millisecondsSinceEpoch}';
    try {
      _qiniu = QiniuDirectClient(peerId: pid);
      await _qiniu!.register();
      _replyPollTimer = Timer.periodic(const Duration(seconds: 2), (_) => _pollReplies());
      log('[chat] reply poll started for chatId=${widget.chatId}');
    } catch (e) {
      log('[chat] qiniu init failed: $e');
    }
  }

  Future<void> _pollReplies() async {
    if (_qiniu == null) return;
    try {
      final keys = await _qiniu!.listFiles('oc/chat/${widget.chatId}/');
      for (final key in keys) {
        if (_seenReplyKeys.contains(key)) continue;
        if (!key.endsWith('-reply.json')) continue;
        // Only display replies created after this screen opened
        final tsMatch = RegExp(r'/(\d+)-reply\.json$').firstMatch(key);
        final ts = tsMatch != null ? int.tryParse(tsMatch.group(1) ?? '0') ?? 0 : 0;
        _seenReplyKeys.add(key);
        if (ts > 0 && ts < _startupTs) continue;

        final bytes = await _qiniu!.getBinary(key);
        if (bytes.isEmpty) continue;
        Map<String, dynamic> json;
        try {
          json = jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
        } catch (e) {
          log('[C14] json parse fail $key: $e');
          continue;
        }
        final text = (json['text'] as String?) ?? (json['error'] as String? ?? '');
        if (text.isEmpty) continue;
        log('[C14] reply $key text="${text.substring(0, min(60, text.length))}"');
        if (mounted) {
          setState(() {
            _messages.add({
              'sender': 'ai', 'type': 'text', 'text': text,
              'time': DateTime.now().toString().substring(11, 16),
            });
          });
          _scrollBottom();
        }
      }
    } catch (e) {
      log('[poll] error: $e');
    }
  }

  @override
  void dispose() {
    _replyPollTimer?.cancel();
    _qiniu?.dispose();
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
      _messages.add({'sender': 'me', 'type': 'text', 'text': text,
        'time': DateTime.now().toString().substring(11, 16)});
    });
    _controller.clear();
    _scrollBottom();
    // Upload to Qiniu so the bridge agent can pick it up
    if (_qiniu != null) {
      final ts = DateTime.now().millisecondsSinceEpoch;
      final msg = jsonEncode({
        'type': 'text', 'sender': 'user', 'text': text, 'ts': ts,
      });
      _qiniu!.putBinary(
        'oc/chat/${widget.chatId}/$ts.msg',
        Uint8List.fromList(utf8.encode(msg)),
      ).catchError((e) => log('[chat] text upload fail: $e'));
    }
  }

  void _startVmRecord() async {
    final ok = await _recorder.startRecord();
    if (ok && mounted) setState(() => _vmRecording = true);
  }

  void _endVmRecord() async {
    final key = await _recorder.stopRecord(chatId: widget.chatId);
    if (key != null) {
      log('[C12] uploaded $key, polling for reply...');
      if (mounted) setState(() {
        _messages.add({'sender': 'me', 'type': 'voice', 'key': key,
          'time': DateTime.now().toString().substring(11, 16)});
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
