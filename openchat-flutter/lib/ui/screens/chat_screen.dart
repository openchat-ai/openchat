import 'dart:async';
import 'dart:convert';
import 'dart:developer' show log;
import 'dart:math' show min;
import 'dart:typed_data';
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

class _ChatScreenState extends ConsumerState<ChatScreen> with SduiPageState, WidgetsBindingObserver {
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
  int _pollIntervalMs = 2000;
  int _replyPollStartTs = 0;
  bool _hasText = false;

  @override
  String? _playingKey;
  final Map<String, int> _voiceDurationMs = {};

  String get sduiPage => 'chat';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _startupTs = DateTime.now().millisecondsSinceEpoch;
    _messages.add({'sender': 'ai', 'type': 'text', 'text': 'Hello! How can I help you?', 'time': '10:00'});
    _player.onStateChange = (key, durMs) {
      if (!mounted) return;
      setState(() {
        _playingKey = key;
        if (key != null && durMs > 0) _voiceDurationMs[key] = durMs;
      });
    };
    _initQiniuPoll();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _pollReplies();
  }

  void _manualCheck() {
    _replyPollTimer?.cancel();
    _pollReplies();
  }

  void _startReplyPoll({int initialDelay = 0}) {
    _replyPollTimer?.cancel();
    _pollIntervalMs = 2000;
    _replyPollStartTs = DateTime.now().millisecondsSinceEpoch;
    SharedPreferences.getInstance().then((prefs) {
      final history = prefs.getStringList('replyTimes')?.map((s) => int.tryParse(s) ?? 0).toList() ?? [];
      final maxHistory = history.isEmpty ? 120000 : history.reduce((a, b) => a > b ? a : b);
      final timeout = (maxHistory * 1.5).round().clamp(120000, 1800000);
      final focusStart = history.isEmpty ? 5000 : (maxHistory * 0.6).round();
      final focusEnd = history.isEmpty ? 30000 : (maxHistory * 1.2).round();
      log('[chat] poll history=$maxHistory ms, focus=[$focusStart, $focusEnd], timeout=$timeout');
      void poll() {
        final elapsed = DateTime.now().millisecondsSinceEpoch - _replyPollStartTs;
        if (elapsed > timeout) {
          log('[chat] poll timeout after ${timeout ~/ 1000}s');
          return;
        }
        // Dense (2s) in focus window, sparse outside
        _pollIntervalMs = (elapsed >= focusStart && elapsed <= focusEnd) ? 2000
            : (_pollIntervalMs * 1.5).round().clamp(5000, 15000);
        _replyPollTimer = Timer(Duration(milliseconds: _pollIntervalMs), () async {
          if (await _pollReplies()) _replyPollTimer?.cancel();
          else poll();
        });
      }
      void start() { poll(); }
      if (initialDelay > 0) Future.delayed(Duration(milliseconds: initialDelay), start);
      else start();
    });
  }

  Future<void> _initQiniuPoll() async {
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'chat_${DateTime.now().millisecondsSinceEpoch}';
    try {
      _qiniu = QiniuDirectClient(peerId: pid);
      await _qiniu!.register();
      log('[chat] qiniu init ok for chatId=${widget.chatId}');
    } catch (e) {
      log('[chat] qiniu init failed: $e');
    }
  }

  Future<bool> _pollReplies() async {
    if (_qiniu == null) return false;
    bool found = false;
    try {
      final keys = await _qiniu!.listFiles('oc/chat/${widget.chatId}/');
      for (final key in keys) {
        if (_seenReplyKeys.contains(key)) continue;
        if (!key.endsWith('-reply.json')) continue;
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
        found = true;
        // Record reply time for adaptive polling
        if (_replyPollStartTs > 0) {
          final replyTime = DateTime.now().millisecondsSinceEpoch - _replyPollStartTs;
          SharedPreferences.getInstance().then((prefs) {
            final list = prefs.getStringList('replyTimes') ?? [];
            list.add(replyTime.toString());
            prefs.setStringList('replyTimes', list.take(20).toList());
          });
        }
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
    return found;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
      final msg = utf8.encode(jsonEncode({
        'type': 'text', 'sender': 'user', 'text': text, 'ts': ts,
      }));
      // EPC header: magic=0xBB, dir=sent=0x00, type=text=0xDD
      final frame = Uint8List(7 + msg.length + 2);
      int off = 0;
      frame[off++] = 0xBB; frame[off++] = 0x00; frame[off++] = 0xDD;
      frame[off++] = (msg.length >> 16) & 0xFF;
      frame[off++] = (msg.length >> 8) & 0xFF;
      frame[off++] = msg.length & 0xFF;
      frame.setRange(off, off + msg.length, msg); off += msg.length;
      int cs = 0;
      for (int i = 1; i < off; i++) cs ^= frame[i];
      frame[off++] = cs; frame[off++] = 0x7E;
      _qiniu!.putBinary(
        'oc/chat/${widget.chatId}/$ts.msg',
        frame,
      ).then((_) => _startReplyPoll(initialDelay: 1500))
       .catchError((e) => log('[chat] text upload fail: $e'));
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
      _startReplyPoll(initialDelay: 2000);
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
            hasText: _hasText,
            onSend: _sendText,
            onStartRecord: _startVmRecord,
            onEndRecord: _endVmRecord,
            onTextChanged: (v) {
              if (!mounted) return;
              setState(() => _hasText = v.isNotEmpty);
            },
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
        itemBuilder: (context, index) {
          final m = _messages[index];
          final key = m['key'] as String?;
          return ChatBubble(
            message: m,
            theme: theme,
            layout: sduiLayout,
            isPlaying: key != null && _playingKey == key,
            durationMs: key != null ? _voiceDurationMs[key] : null,
            onPlayVoice: () => _playVoiceMsg(key ?? ''),
          );
        });
  }
}
