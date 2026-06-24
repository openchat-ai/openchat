import 'dart:async';
import 'dart:developer' show log;
import 'dart:io' show Platform;
import 'dart:math' hide log;
import 'dart:ui' show ImageFilter;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sdui_engine/sdui_engine.dart' show SduiParser;
import 'package:speech_to_text/speech_to_text.dart' as stt;
import 'package:flutter_tts/flutter_tts.dart';

import '../../core/api/base_client.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/audio.dart';
import '../../core/models/agent_model.dart';
import '../../core/models/chat_message.dart';
import '../../core/models/resident_model.dart';
import '../../core/protocol/epc.dart';
import '../../core/sdui_config.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import '../components/resident/resident.dart';
import '../widgets/common/animated_dots.dart';
import '../widgets/widgets.dart';

import 'screens_voice.dart';

// =============================================================================
// agent_hub_widgets.dart
// =============================================================================

class AgentHubWidgets {
  static Widget buildEmptyState(AppTheme theme, Map? state) {
    if (state == null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.person_outline, color: theme.textTertiary, size: 64),
        const SizedBox(height: 16),
        Text('\u8FD8\u6CA1\u6709AI \u5C45\u6C11', style: TextStyle(color: theme.textSecondary, fontSize: 16)),
      ]));
    }
    final parser = SduiParser(vars: {}, onAction: null);
    final node = {
      'type': 'column', 'center': true, 'children': [
        {'type': 'padding', 'padding': 32, 'child': {'type': 'icon', 'icon': state['icon'] ?? 'person', 'size': 64}},
        if (state['title'] != null) {'type': 'text', 'content': state['title'], 'style': {'size': 16}, 'pad': 8},
        if (state['subtitle'] != null) {'type': 'text', 'content': state['subtitle'], 'style': {'size': 13, 'color': '#9E9E9E'}},
      ],
    };
    return Center(child: parser.parse(node));
  }

  static Widget buildActionButton(IconData icon, AppTheme theme, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(right: 8), padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
          border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
        child: Icon(icon, color: theme.textSecondary, size: 20),
      ),
    );
  }
}

class ResidentFallbackList extends StatelessWidget {
  final AppTheme theme;
  final List<Resident> residents;
  final Widget emptyState;

  const ResidentFallbackList({
    super.key,
    required this.theme,
    required this.residents,
    required this.emptyState,
  });

  @override
  Widget build(BuildContext context) {
    if (residents.isEmpty) return emptyState;
    return ListView(padding: const EdgeInsets.all(16), children: residents.map((r) {
      final isActive = r.isActive;
      return Container(
        margin: const EdgeInsets.only(bottom: 16), padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusLarge),
          border: Border.all(color: isActive ? theme.gradientPrimary[0].withValues(alpha: 0.4)
            : theme.textTertiary.withValues(alpha: 0.08), width: 1)),
        child: Row(children: [
          Text(r.name.isNotEmpty ? r.name[0] : '?',
            style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(r.name, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
            Text('ID: ${r.id} \u00B7 ${r.home}', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
          ])),
        ]),
      );
    }).toList());
  }
}

// =============================================================================
// agent_hub_screen.dart
// =============================================================================

class AgentHubScreen extends ConsumerStatefulWidget {
  const AgentHubScreen({super.key});

  @override
  ConsumerState<AgentHubScreen> createState() => _AgentHubScreenState();
}

class _AgentHubScreenState extends ConsumerState<AgentHubScreen> with SduiPageState {
  @override
  String get sduiPage => 'agent';

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final residentsAsync = ref.watch(residentProvider);
    final title = sduiStr('title', 'AI Residents');

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 24,
          fontWeight: FontWeight.bold, letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 2)),
        actions: [
          AgentHubWidgets.buildActionButton(Icons.refresh_rounded, theme, () => ref.read(residentProvider.notifier).refresh()),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: residentsAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => AgentHubWidgets.buildEmptyState(theme, sduiLayout['errorState'] as Map? ?? {'icon': 'error', 'title': '\u52A0\u8F7D\u5931\u8D25'}),
            data: (residents) {
              final residentItems = residents.map((r) => {
                'id': r.id.toString(),
                'name': r.name,
                'status': r.status,
                'home': r.home,
                'isActive': r.isActive.toString(),
                'isDeleted': r.isDeleted.toString(),
                'daysSince': _daysSince(r.createdAt).toString(),
                'avatar': r.name.isNotEmpty ? r.name[0] : '?',
              }).toList();
              final listLayout = sduiLayout['listLayout'] as Map?;
              if (listLayout != null) {
                final sl = sduiLayout['stats'] as Map?;
                final active = residents.where((r) => r.isActive).length;
                final sleeping = residents.where((r) => r.status == 'sleeping').length;
                final deleted = residents.where((r) => r.isDeleted).length;
                final parser = SduiParser(onAction: (a) {
                  if (a == 'create') _showCreateDialog(context, theme);
                  else if (a.startsWith('navigate:')) Navigator.push(context, MaterialPageRoute(
                    builder: (_) => ResidentDetailScreen(residentId: a.substring(9))));
                  else if (a.startsWith('delete:')) {
                    final id = a.substring(7);
                    final r = residents.where((x) => x.id.toString() == id).firstOrNull;
                    if (r != null) _confirmDelete(context, r);
                  }
                }, vars: {
                  'items': residentItems,
                  'active': active.toString(),
                  'sleeping': sleeping.toString(),
                  'deleted': deleted.toString(),
                  'sectionTitle': sduiStr('sectionTitle', 'Residents'),
                  'statsIcon1': sl?['icon1'] ?? 'active',
                  'statsLabel1': sl?['label1'] ?? 'Active',
                  'statsIcon2': sl?['icon2'] ?? 'sleep',
                  'statsLabel2': sl?['label2'] ?? '\u4F11\u7720',
                  'statsIcon3': sl?['icon3'] ?? 'check',
                  'statsLabel3': sl?['label3'] ?? '\u5DF2\u6CE8\u9500',
                });
                final widget = parser.parse(listLayout);
                if (widget != null) {
                  return SingleChildScrollView(child: widget);
                }
              }
              return ResidentFallbackList(
                theme: theme,
                residents: residents,
                emptyState: AgentHubWidgets.buildEmptyState(theme, sduiLayout['emptyState'] as Map?),
              );
            },
          ),
        ),
      ),
      floatingActionButton: _buildCreateButton(theme),
    );
  }

  Widget _buildCreateButton(AppTheme theme) {
    return Container(
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        gradient: LinearGradient(colors: theme.gradientPrimary),
        borderRadius: BorderRadius.circular(theme.radiusMedium - 4)),
      child: FloatingActionButton.extended(
        onPressed: () => _showCreateDialog(context, theme),
        backgroundColor: Colors.transparent, elevation: 0,
        icon: const Icon(Icons.person_add_rounded, color: Colors.white),
        label: const Text('New Resident', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
      ),
    );
  }

  void _showCreateDialog(BuildContext context, AppTheme theme) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(sduiLayout['createTitle'] as String? ?? 'Create AI Resident', style: TextStyle(color: theme.textPrimary)),
        content: TextField(
          controller: controller, autofocus: true,
          decoration: InputDecoration(
            hintText: sduiLayout['createHint'] as String? ?? 'Name (leave empty for auto)',
            hintStyle: TextStyle(color: theme.textTertiary),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: theme.textTertiary.withValues(alpha: 0.2))),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: theme.primary))),
          style: TextStyle(color: theme.textPrimary)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel', style: TextStyle(color: theme.textSecondary))),
          TextButton(onPressed: () {
            final name = controller.text.trim();
            ref.read(residentProvider.notifier).create(name: name.isEmpty ? null : name);
            Navigator.pop(ctx);
          }, child: Text('Create', style: TextStyle(color: theme.primary))),
        ],
      ),
    );
  }

  void _confirmDelete(BuildContext context, Resident resident) {
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Confirm Delete'), content: Text('Delete "${resident.name}"?'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        TextButton(onPressed: () { ref.read(residentProvider.notifier).delete(resident.id); Navigator.pop(ctx); },
          child: const Text('Delete', style: TextStyle(color: Colors.red))),
      ],
    ));
  }

  int _daysSince(DateTime date) => DateTime.now().difference(date).inDays;
}

// =============================================================================
// chat_list_screen.dart
// =============================================================================

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

// =============================================================================
// chat_screen.dart
// =============================================================================

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
  final List<ChatMessage> _messages = [];
  final ScrollController _scrollController = ScrollController();
  final _recorder = ChatVoiceRecorder();
  final _player = ChatVoicePlayer();
  final _speech = stt.SpeechToText();
  final _tts = FlutterTts();
  String? _asrText;
  bool _asrReady = false;
  QiniuDirectClient? _qiniu;
  Timer? _replyPollTimer;
  final Set<String> _seenReplyKeys = {};
  bool _vmRecording = false;
  bool _isWaiting = false;
  int _startupTs = 0;
  int _pollIntervalMs = 1000;
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
    _messages.add(ChatMessage(sender: MessageSender.ai, type: MessageType.text, text: 'Hello! How can I help you?', time: '10:00', ts: DateTime.now().millisecondsSinceEpoch));
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
    if (!mounted) return;
    _replyPollTimer?.cancel();
    _pollIntervalMs = 1000;
    _replyPollStartTs = DateTime.now().millisecondsSinceEpoch;
    void poll() {
      final elapsed = DateTime.now().millisecondsSinceEpoch - _replyPollStartTs;
      if (elapsed > 120000) {
        log('[chat] poll timeout after ${elapsed ~/ 1000}s');
        return;
      }
      _replyPollTimer = Timer(Duration(milliseconds: _pollIntervalMs), () async {
        if (!mounted) return;
        if (await _pollReplies()) _replyPollTimer?.cancel();
        else poll();
      });
    }
    void start() { poll(); }
    if (initialDelay > 0) Future.delayed(Duration(milliseconds: initialDelay), start);
    else start();
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
        // 支持流式 -stream.bin 和最终 -reply.epc
        final streamMatch = RegExp(r'/(\d+)-stream\.bin$').firstMatch(key);
        final replyMatch = RegExp(r'/(\d+)-reply\.epc$').firstMatch(key);
        if (streamMatch == null && replyMatch == null) continue;
        final tsStr = (streamMatch ?? replyMatch)!.group(1) ?? '0';
        final ts = int.tryParse(tsStr) ?? 0;
        if (replyMatch != null) _seenReplyKeys.add(key);
        if (ts > 0 && ts < _startupTs) continue;

        final bytes = await _qiniu!.getBinary(key);
        if (bytes.isEmpty) continue;
        final frames = Epc.parseLlmReply(bytes);
        if (frames.isEmpty) continue;
        final content = frames['content'] as String? ?? '';
        final reasoning = frames['reasoning_content'] as String? ?? '';
        final error = frames['error'] as String? ?? '';
        final meta = frames['meta'];
        final bypass = meta is Map ? meta['bypass'] == true : false;
        final bypassText = meta is Map ? meta['bypassText'] as String? : null;
        final isError = error.isNotEmpty;
        final text = bypass && bypassText != null ? bypassText : (isError ? error : content);
        if (text.isEmpty && reasoning.isEmpty) continue;
        log('[C14] reply $key text="${text.substring(0, min(60, text.length))}"');
        if (replyMatch != null) found = true;
        if (mounted) {
          final hash = meta is Map ? meta['hash'] as String? : null;
          setState(() {
            _isWaiting = false;
            // 查找已有的 AI 消息 (按 requestTs 匹配，用于流式累积)
            final existingIdx = _messages.lastIndexWhere(
              (m) => m.sender == MessageSender.ai && m.requestTs == ts,
            );
            if (existingIdx >= 0) {
              _messages[existingIdx] = _messages[existingIdx].copyWith(
                text: text,
                reasoning: reasoning.isNotEmpty ? reasoning : null,
                isError: isError,
                hash: hash ?? _messages[existingIdx].hash,
              );
            } else {
              _messages.add(ChatMessage(
                sender: MessageSender.ai,
                type: MessageType.text,
                text: text,
                time: DateTime.now().toString().substring(11, 16),
                ts: DateTime.now().millisecondsSinceEpoch,
                requestTs: ts,
                isNew: true,
                isError: isError,
                hash: hash,
                reasoning: reasoning.isNotEmpty ? reasoning : null,
              ));
            }
          });
          if (replyMatch != null) _tts.speak(text);
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
    _qiniu = null;
    _controller.dispose();
    _scrollController.dispose();
    _recorder.dispose(); // fire-and-forget (OK in sync dispose)
    _player.dispose(); // fire-and-forget (OK in sync dispose)
    super.dispose();
  }

  void _sendText() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    final ts = DateTime.now().millisecondsSinceEpoch;
    setState(() {
      _messages.add(ChatMessage(
        sender: MessageSender.me,
        type: MessageType.text,
        text: text,
        time: DateTime.now().toString().substring(11, 16),
        ts: ts,
        requestTs: ts,
        isNew: true,
      ));
      _isWaiting = true;
    });
    _controller.clear();
    _scrollBottom();
    if (_qiniu != null) {
      final frame = Epc.encodeChatMessage(text);
      _qiniu!.putBinary(
        'oc/chat/${widget.chatId}/$ts.epc',
        frame,
      ).then((_) { if (mounted) _startReplyPoll(initialDelay: 1500); })
       .catchError((e) {
         log('[chat] text upload fail: $e');
         if (mounted) setState(() => _isWaiting = false);
       });
    } else {
      log('[chat] qiniu not ready');
      if (mounted) setState(() => _isWaiting = false);
    }
  }

  void _startVmRecord() async {
    final speechOk = await _speech.initialize(
      onError: (e) { if (mounted) setState(() => _vmRecording = false); log('[asr] init error: $e'); },
    );
    if (!speechOk || !mounted) return;
    _asrText = '';
    _asrReady = true;
    setState(() => _vmRecording = true);
    _speech.listen(
      onResult: (r) { _asrText = r.recognizedWords; },
      localeId: 'zh_CN',
    );
  }

  void _endVmRecord() async {
    if (_asrReady) {
      await _speech.stop();
      _asrReady = false;
    }
    final transcribed = (_asrText ?? '').trim();
    if (transcribed.isNotEmpty && _qiniu != null && mounted) {
      final ts = DateTime.now().millisecondsSinceEpoch;
      final msgKey = 'oc/chat/${widget.chatId}/$ts.epc';
      final frame = Epc.encodeChatMessage(transcribed);
      await _qiniu!.putBinary(msgKey, frame);
      log('[C12] asr epc=$msgKey text="$transcribed"');
      setState(() {
        _messages.add(ChatMessage(
          sender: MessageSender.me,
          type: MessageType.text,
          text: transcribed,
          time: DateTime.now().toString().substring(11, 16),
          ts: ts,
        ));
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
    final subtitle = sduiLayout['subtitle'] as String?;

    return Scaffold(
      backgroundColor: theme.background,
      extendBodyBehindAppBar: true,
      appBar: PreferredSize(
        preferredSize: const Size.fromHeight(64),
        child: ClipRRect(
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
            child: Container(
              decoration: BoxDecoration(
                color: theme.surface.withValues(alpha: 0.6),
                border: Border(
                  bottom: BorderSide(
                    color: theme.textTertiary.withValues(alpha: 0.08),
                    width: 0.5,
                  ),
                ),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [
                    theme.primary.withValues(alpha: 0.05),
                    theme.secondary.withValues(alpha: 0.05),
                  ],
                ),
              ),
              child: SafeArea(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  child: Row(children: [
                    IconButton(
                      icon: Icon(Icons.arrow_back_ios_new, color: theme.textPrimary, size: 18),
                      onPressed: () => Navigator.of(context).maybePop(),
                    ),
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(colors: theme.gradientPrimary, begin: Alignment.topLeft, end: Alignment.bottomRight),
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: [BoxShadow(color: theme.primary.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 2))],
                      ),
                      child: const Icon(Icons.chat_bubble_outline, color: Colors.white, size: 18),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600, letterSpacing: 0.2), overflow: TextOverflow.ellipsis),
                          if (subtitle != null || _isWaiting)
                            Row(mainAxisSize: MainAxisSize.min, children: [
                              Container(
                                width: 6, height: 6,
                                decoration: BoxDecoration(
                                  color: _isWaiting ? theme.warning : theme.success,
                                  shape: BoxShape.circle,
                                  boxShadow: [BoxShadow(color: (_isWaiting ? theme.warning : theme.success).withValues(alpha: 0.6), blurRadius: 4, spreadRadius: 0.5)],
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                _isWaiting ? 'AI thinking...' : (subtitle ?? '鍦ㄧ嚎'),
                                style: TextStyle(color: theme.textTertiary, fontSize: 11),
                              ),
                            ]),
                        ],
                      ),
                    ),
                    IconButton(icon: Icon(sduiLayout['callIcon'] == null ? Icons.phone_outlined : (SduiParser.icons[sduiLayout['callIcon']] ?? Icons.phone_outlined), color: theme.textSecondary, size: 20), onPressed: () {}),
                    IconButton(icon: Icon(Icons.videocam_outlined, color: theme.textSecondary, size: 20), onPressed: () {}),
                    IconButton(icon: Icon(Icons.more_horiz, color: theme.textSecondary, size: 20), onPressed: () {}),
                  ]),
                ),
              ),
            ),
          ),
        ),
      ),
      body: Stack(children: [
        // subtle radial gradient overlay
        Positioned.fill(child: IgnorePointer(child: Container(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: Alignment.topLeft,
              radius: 1.5,
              colors: [
                theme.primary.withValues(alpha: 0.08),
                Colors.transparent,
              ],
            ),
          ),
        ))),
        Column(
          children: [
            const SizedBox(height: 64), // appbar height offset
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
      ]),
    );
  }

  Widget _buildMessageList(AppTheme theme) {
    final msgLayout = sduiLayout['messageLayout'] as Map?;
    if (msgLayout != null) {
      final msgItems = _messages.map((m) => {
        'text': m.text,
        'time': m.time,
        'isMe': m.isMe.toString(),
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
    return Column(children: [
      Expanded(child: ListView.builder(
          controller: _scrollController,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
          itemCount: _messages.length,
          itemBuilder: (context, index) {
            final m = _messages[index];
            final key = m.key;
            final isNew = m.isNew;
            return TweenAnimationBuilder<double>(
              key: ValueKey('msg-${m.ts}'),
              tween: Tween(begin: isNew ? 0.0 : 1.0, end: 1.0),
              duration: Duration(milliseconds: isNew ? 320 : 0),
              curve: Curves.easeOutCubic,
              builder: (context, t, child) {
                return Opacity(
                  opacity: t.clamp(0.0, 1.0),
                  child: Transform.translate(
                    offset: Offset(0, (1 - t) * 12),
                    child: child,
                  ),
                );
              },
              child: ChatBubble(
                message: m,
                theme: theme,
                layout: sduiLayout,
                isPlaying: key != null && _playingKey == key,
                durationMs: key != null ? _voiceDurationMs[key] : null,
                onPlayVoice: () => _playVoiceMsg(key ?? ''),
              ),
            );
          })),
      if (_isWaiting)
        Padding(
          padding: const EdgeInsets.only(left: 16, bottom: 8),
          child: Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: theme.surface.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(16).copyWith(bottomLeft: const Radius.circular(4)),
              ),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                AnimatedDots(color: theme.textTertiary),
                const SizedBox(width: 8),
                Text('AI thinking...', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
              ]),
            ),
          ]),
        ),
    ]);
  }
}

// =============================================================================
// dev_ide_screen.dart
// =============================================================================

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

// =============================================================================
// home_screen.dart
// =============================================================================

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> with SduiPageState {
  @override
  String get sduiPage => 'home';

  IconData _iconForType(String type) {
    switch (type) {
      case 'born': return Icons.celebration_outlined;
      case 'awake': return Icons.wb_sunny_outlined;
      case 'sleeping': return Icons.nights_stay_outlined;
      case 'task_assigned': return Icons.assignment_outlined;
      case 'task_done': return Icons.task_alt_rounded;
      case 'task_failed': return Icons.error_outline_rounded;
      case 'collab_started': return Icons.connect_without_contact_rounded;
      case 'collab_done': return Icons.handshake_outlined;
      case 'sage_ask': return Icons.help_outline;
      case 'sage_answer': return Icons.reply_rounded;
      case 'sage_guide': return Icons.auto_awesome_outlined;
      case 'sage_praise': return Icons.favorite_outline;
      default: return Icons.circle_outlined;
    }
  }

  Color _colorForType(String type, AppTheme theme) {
    switch (type) {
      case 'born': return theme.gradientPrimary[0];
      case 'awake': return Colors.orangeAccent;
      case 'sleeping': return Colors.indigoAccent;
      case 'task_assigned': return theme.primary;
      case 'task_done': return theme.success;
      case 'task_failed': return theme.error;
      case 'collab_started': return Colors.teal;
      case 'collab_done': return Colors.deepOrangeAccent;
      case 'sage_ask': return Colors.amber;
      case 'sage_answer': return Colors.green;
      case 'sage_guide': return Colors.purpleAccent;
      case 'sage_praise': return Colors.pinkAccent;
      default: return theme.textTertiary;
    }
  }

  String _timeAgo(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inSeconds < 60) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final feedAsync = ref.watch(feedProvider);
    final title = sduiStr('title', 'Feed');

    return Scaffold(
      extendBodyBehindAppBar: true,
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 24,
          fontWeight: FontWeight.bold, letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 1)),
        actions: [
          _buildIconButton(Icons.refresh_rounded, theme, () => ref.read(feedProvider.notifier).refresh()),
          const SizedBox(width: 8),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(gradient: LinearGradient(
          colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
        child: SafeArea(
          child: feedAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => _buildEmptyState(theme, sduiLayout['errorState'] as Map? ?? {'icon': 'people', 'title': 'OpenChat', 'subtitle': '\u5207\u6362\u5230 \u597D\u53CB \u6807\u7B7E'}),
            data: (feed) {
              if (feed.isEmpty) {
                return _buildEmptyState(theme, sduiLayout['emptyState'] as Map?);
              }
              final feedItems = feed.map((item) => {
                'name': item.residentName,
                'role': item.agentRole ?? '',
                'message': item.message,
                'summary': item.summary ?? '',
                'timeAgo': _timeAgo(item.timestamp),
                'typeIcon': sduiLayout['icons'] is Map ? (sduiLayout['icons'] as Map)[item.type] as String? ?? 'circle' : 'circle',
                'typeColor': item.type == 'born' ? '#7C4DFF' :
                  item.type == 'awake' ? '#FF9800' :
                  item.type == 'task_done' ? '#4CAF50' :
                  item.type == 'task_failed' ? '#F44336' : '#7C4DFF',
                'showRole': item.agentRole != null && item.agentRole != 'custom',
              }).toList();
              final layout = sduiLayout['feedLayout'] as Map?;
              if (layout != null) {
                final parser = SduiParser(onAction: null, vars: {'items': feedItems});
                final widget = parser.parse(layout);
                if (widget != null) {
                  return SingleChildScrollView(padding: const EdgeInsets.all(16), child: widget);
                }
              }
              return ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: feed.length,
                itemBuilder: (context, index) => _buildFeedItem(context, theme, feed[index]),
              );
            },
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState(AppTheme theme, Map? state) {
    if (state == null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.inbox_outlined, color: theme.textTertiary, size: 64),
        const SizedBox(height: 16),
        Text('\u793E\u533A\u8FD8\u5F88\u5B89\u9759', style: TextStyle(color: theme.textSecondary, fontSize: 16)),
      ]));
    }
    final parser = SduiParser(vars: {}, onAction: null);
    final node = {
      'type': 'column', 'center': true, 'children': [
        {'type': 'padding', 'padding': 32, 'child': {'type': 'icon', 'icon': state['icon'] ?? 'inbox', 'size': 64}},
        if (state['title'] != null) {'type': 'text', 'content': state['title'], 'style': {'size': 16}, 'pad': 8},
        if (state['subtitle'] != null) {'type': 'text', 'content': state['subtitle'], 'style': {'size': 13, 'color': '#9E9E9E'}},
      ],
    };
    return Center(child: parser.parse(node));
  }

  Widget _buildIconButton(IconData icon, AppTheme theme, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(right: 8), padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
          border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
        child: Icon(icon, color: theme.textSecondary, size: 20),
      ),
    );
  }

  Widget _buildFeedItem(BuildContext context, AppTheme theme, FeedItem item) {
    final color = _colorForType(item.type, theme);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusLarge),
          border: Border.all(color: theme.textTertiary.withValues(alpha: 0.06))),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(width: 40, height: 40,
            decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
            child: Icon(_iconForType(item.type), color: color, size: 20)),
          const SizedBox(width: 12),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Text(item.residentName, style: TextStyle(color: theme.textPrimary, fontWeight: FontWeight.w600, fontSize: 14)),
              if (item.agentRole != null && item.agentRole != 'custom') ...[
                const SizedBox(width: 6),
                Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(4)),
                  child: Text(item.agentRole!, style: TextStyle(color: color, fontSize: 10))),
              ],
            ]),
            const SizedBox(height: 4),
            Text(item.message, style: TextStyle(color: theme.textSecondary, fontSize: 13),
              maxLines: 2, overflow: TextOverflow.ellipsis),
            if (item.summary != null && item.summary!.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(item.summary!.replaceAll('\n', ' '), style: TextStyle(color: theme.textTertiary, fontSize: 11),
                maxLines: 2, overflow: TextOverflow.ellipsis),
            ],
            const SizedBox(height: 4),
            Text(_timeAgo(item.timestamp), style: TextStyle(color: theme.textTertiary, fontSize: 11)),
          ])),
        ]),
      ),
    );
  }
}

// =============================================================================
// main_screen.dart
// =============================================================================

final bottomNavIndexProvider = StateProvider<int>((ref) => 0);

class MainScreen extends ConsumerStatefulWidget {
  const MainScreen({super.key});

  @override
  ConsumerState<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends ConsumerState<MainScreen> with SduiPageState {
  @override
  String get sduiPage => 'main';

  final Set<int> _visitedTabs = {0};

  Widget _buildScreen(String name) {
    switch (name) {
      case 'home': return const HomeScreen();
      case 'agent': return const AgentHubScreen();
      case 'people': return const PeopleScreen();
      case 'chat': return const ChatListScreen();
      case 'dev': return const DevIdeScreen();
      case 'settings': return const SettingsScreen();
      default: return Center(child: Text('Unknown: $name'));
    }
  }

  ({IconData inactive, IconData active}) _resolveIcon(String name) {
    switch (name) {
      case 'home': return (inactive: Icons.home_outlined, active: Icons.home_rounded);
      case 'plan': return (inactive: Icons.description_outlined, active: Icons.description_rounded);
      case 'agent': return (inactive: Icons.psychology_outlined, active: Icons.psychology_rounded);
      case 'people': return (inactive: Icons.people_outline, active: Icons.people_rounded);
      case 'chat': return (inactive: Icons.chat_bubble_outline, active: Icons.chat_bubble_rounded);
      case 'dev': return (inactive: Icons.code_outlined, active: Icons.code_rounded);
      case 'settings': return (inactive: Icons.person_outline, active: Icons.person_rounded);
      default: return (inactive: Icons.circle_outlined, active: Icons.circle_rounded);
    }
  }

  static const _fallbackTabs = [
    {'icon': 'home', 'label': 'Home', 'screen': 'home'},
    {'icon': 'agent', 'label': 'Agent', 'screen': 'agent'},
    {'icon': 'chat', 'label': 'Chat', 'screen': 'chat'},
    {'icon': 'people', 'label': 'People', 'screen': 'people'},
    {'icon': 'settings', 'label': 'Settings', 'screen': 'settings'},
  ];

  List<Map<String, dynamic>> _getTabs() {
    final raw = sduiLayout['tabs'];
    if (raw is List && raw.isNotEmpty) return raw.cast<Map<String, dynamic>>();
    return _fallbackTabs;
  }

  @override
  Widget build(BuildContext context) {
    final currentIndex = ref.watch(bottomNavIndexProvider);
    final theme = ref.watch(currentThemeProvider);
    final tabs = _getTabs();
    final clampedIndex = currentIndex.clamp(0, tabs.length - 1);
    _visitedTabs.add(clampedIndex);
    final fab = sduiLayout['fab'] as Map? ?? {};
    final fabIcon = fab['icon'] as String? ?? 'palette';
    final fabAction = fab['action'] as String? ?? 'theme';
    final navBarHeight = (sduiLayout['navBarHeight'] as num?)?.toDouble() ?? 80.0;

    return Scaffold(
      extendBody: false,
      extendBodyBehindAppBar: false,
      backgroundColor: theme.background,
      body: Padding(
        padding: EdgeInsets.only(bottom: navBarHeight),
        child: IndexedStack(
          index: clampedIndex,
          children: tabs.asMap().entries.map((e) => _visitedTabs.contains(e.key)
              ? _buildScreen(e.value['screen'] as String? ?? 'home')
              : const SizedBox.shrink()).toList(),
        ),
      ),
      bottomNavigationBar: _buildBottomNav(context, clampedIndex, theme, tabs),
      floatingActionButton: fab['hidden'] == true ? null : FloatingActionButton(
            onPressed: () {
              if (fabAction == 'theme') Navigator.pushNamed(context, '/theme');
              else if (fabAction.startsWith('navigate:')) Navigator.pushNamed(context, fabAction.substring(9));
            },
            backgroundColor: _hexColor(fab['color']) ?? theme.primary,
            child: Icon(_fabIcon(fabIcon), color: Colors.white),
          ),
      );
  }

  IconData _fabIcon(String name) {
    switch (name) {
      case 'palette': return Icons.palette;
      case 'add': return Icons.add;
      case 'settings': return Icons.settings;
      case 'person': return Icons.person;
      default: return Icons.palette;
    }
  }

  Color? _hexColor(String? s) {
    if (s == null) return null;
    return Color(int.parse(s.replaceAll('#', '0xFF')));
  }

  Widget _buildBottomNav(BuildContext context, int currentIndex, AppTheme theme, List<Map<String, dynamic>> tabs) {
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 20),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.8),
        borderRadius: BorderRadius.circular(32),
        border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1),
        boxShadow: theme.shadows,
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: tabs.asMap().entries.map((entry) {
            final index = entry.key;
            final item = entry.value;
            final iconName = item['icon'] as String? ?? 'home';
            final label = item['label'] as String? ?? '';
            final icons = _resolveIcon(iconName);
            final isSelected = index == currentIndex;
            return GestureDetector(
              onTap: () => ref.read(bottomNavIndexProvider.notifier).state = index,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeInOutBack,
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  gradient: isSelected ? LinearGradient(colors: theme.gradientPrimary) : null,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: isSelected ? [BoxShadow(color: theme.primary.withValues(alpha: 0.4), blurRadius: 20, spreadRadius: 2)] : null,
                ),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  AnimatedScale(scale: isSelected ? 1.2 : 1.0, duration: const Duration(milliseconds: 200),
                    child: Icon(isSelected ? icons.active : icons.inactive, color: isSelected ? Colors.white : theme.textTertiary, size: 22)),
                  const SizedBox(height: 4),
                  Text(label, style: TextStyle(color: isSelected ? Colors.white : theme.textTertiary, fontSize: 9, fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal)),
                ]),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }
}

// =============================================================================
// people_screen.dart
// =============================================================================

class PeopleScreen extends ConsumerStatefulWidget {
  const PeopleScreen({super.key});

  @override
  ConsumerState<PeopleScreen> createState() => _PeopleScreenState();
}

class _PeopleScreenState extends ConsumerState<PeopleScreen> {
  QiniuDirectClient? _client;
  List<Map<String, dynamic>> _users = [];
  String? _error;
  bool _loading = true;
  bool _refreshing = false;
  Timer? _pollTimer;
  Map? _uiConfig;
  int _lastHeartbeatMs = 0;
  static const int _heartbeatIntervalMs = 30000;
  VoiceUiConfig _uiVoice = const VoiceUiConfig();
  @override
  void initState() {
    super.initState();
    VoiceUiConfig.load().then((c) { if (mounted) setState(() => _uiVoice = c); });
    _init();
  }

  Future<void> _init() async {
    final prefs = await SharedPreferences.getInstance();
    String? peerId = prefs.getString('peerId');
    if (peerId == null) {
      try {
        final host = Platform.localHostname;
        if (host.isNotEmpty) peerId = host.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
      } catch (_) {}
      peerId ??= '${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999).toString().padLeft(5, '0')}';
      await prefs.setString('peerId', peerId);
    }
    _client = QiniuDirectClient(peerId: peerId);
    try {
      await _client!.register().timeout(const Duration(seconds: 8));
      await QiniuDirectClient.fetchConfigFile('oc/config/app.json').timeout(const Duration(seconds: 8));
      _uiConfig = await sduiSource.load('people')
          .timeout(const Duration(seconds: 8));
      _pollTimer = Timer.periodic(Duration(milliseconds: _client!.pollIntervalMs), (_) => _pollUsers());
      await _pollUsers().timeout(const Duration(seconds: 10));
    } catch (e) {
      _pollTimer?.cancel();
      _client?.dispose();
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }
  void _startPoll() {
    if (_client == null) return;
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(Duration(milliseconds: _client!.pollIntervalMs), (_) => _pollUsers());
  }
  @override
  void dispose() {
    _pollTimer?.cancel();
    _client?.unregisterAndDispose();
    super.dispose();
  }
  Future<void> _pollUsers() async {
    if (!mounted) return;
    setState(() => _refreshing = true);
    try {
      final users = await _client!.discoverUsers().timeout(const Duration(seconds: 8));
      if (!mounted) return;
      setState(() {
        _users = users.where((u) => u['peerId'] != _client!.peerId).toList();
        _error = null;
        _loading = false;
      });
      if (_uiConfig == null) {
        final newConfig = await sduiSource.load('people')
            .timeout(const Duration(seconds: 5));
        if (newConfig != null) _uiConfig = newConfig;
      }
      final signals = await _client!.pollIncoming().timeout(const Duration(seconds: 8));
      for (final s in signals) {
        final action = s['action'] as String?;
        final from = s['fromPeerId'] as String?;
        if (action == 'call-request' && from != null && mounted) _showIncomingCall(from);
      }
      final nowMs = DateTime.now().millisecondsSinceEpoch;
      if (nowMs - _lastHeartbeatMs >= _heartbeatIntervalMs) {
        _lastHeartbeatMs = nowMs;
        await _client!.heartbeat().timeout(const Duration(seconds: 8));
      }
      await _client!.pollDebug().timeout(const Duration(seconds: 8));
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
    if (!mounted) return;
    setState(() => _refreshing = false);
  }

  void _showIncomingCall(String fromPeerId) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: Text(_uiVoice.incomingTitle),
        content: Text(_uiVoice.incomingBody_(fromPeerId)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(_uiVoice.declineLabel)),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              _pollTimer?.cancel();
              Navigator.pushNamed(context, '/voice', arguments: {
                'targetPeerId': fromPeerId,
                'client': _client,
              }).then((_) => _startPoll());
            },
            child: Text(_uiVoice.acceptLabel),
          ),
        ],
      ),
    );
  }
  void _callUser(String targetPeerId) async {
    if (_client == null) return;
    final isLoopback = targetPeerId == _client!.peerId || targetPeerId == 'demo_user';
    try {
      if (!isLoopback) {
        await _client!.sendSignal(targetPeerId, 'call-request');
      }
      if (mounted) {
        _pollTimer?.cancel();
        Navigator.pushNamed(context, '/voice', arguments: {
          'targetPeerId': targetPeerId,
          'client': _client,
          if (isLoopback) 'selfTest': 'true',
        }).then((_) => _startPoll());
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Call failed'), duration: Duration(seconds: 2)),
        );
      }
    }
  }
  Future<void> _spawnDemo() async {
    if (_client == null) return;
    await _client!.spawnDemoPeer();
    await _pollUsers();
  }
  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    if (_uiConfig != null && !_loading && _error == null) {
      try {
        return PeopleSduiView(
          users: _users,
          uiConfig: _uiConfig! as Map<String, dynamic>,
          client: _client!,
          theme: theme,
          onRefresh: _pollUsers,
          onAction: (action) => PeopleActionDispatcher.handle(
            action,
            SduiActionContext(
              context: context,
              users: _users,
              client: _client,
              uiConfig: _uiConfig,
              onPollUsers: _pollUsers,
              onCall: _callUser,
            ),
          ),
        );
      } catch (e) {
        log('[people] SDUI build error: $e');
      }
    }
    return PeopleFallbackView(
      loading: _loading,
      error: _error,
      users: _users,
      client: _client,
      theme: theme,
      onRefresh: _pollUsers,
      onSpawnDemo: _spawnDemo,
      onCall: _callUser,
    );
  }
}


// =============================================================================
// resident_detail_screen.dart
// =============================================================================

class ResidentDetailScreen extends ConsumerStatefulWidget {
  final String residentId;
  const ResidentDetailScreen({super.key, required this.residentId});

  @override
  ConsumerState<ResidentDetailScreen> createState() => _ResidentDetailScreenState();
}

class _ResidentDetailScreenState extends ConsumerState<ResidentDetailScreen> with SduiPageState {
  @override
  String get sduiPage => 'resident_detail';
  Resident? _resident;
  List<Agent> _agents = [];
  List<Resident> _children = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final id = int.tryParse(widget.residentId) ?? 0;
      final notifier = ref.read(residentProvider.notifier);
      _resident = await notifier.getDetail(id);
      _agents = await notifier.getAgents(id);
      _children = (await notifier.getChildren(id)).whereType<Resident>().toList();
      ref.read(sageProvider.notifier).loadConversation(id);
    } catch (e) {
      log('[resident] _load error: $e');
    }
    if (mounted) setState(() => _loading = false);
  }

  void _showScore() {
    const gap = 0.05;
    const dur = 0.4;
    final midis = [60, 62, 64, 65, 67, 69, 71, 72];
    final notes = List.generate(midis.length, (i) => ScoreNote(midi: midis[i], startSec: i * (dur + gap), durSec: dur));
    showModalBottomSheet(
      context: context,
      backgroundColor: ref.read(currentThemeProvider).surface,
      builder: (_) => ResidentMusicScore(title: 'C Major Scale', notes: notes),
    );
  }

  void _showCreateAgentDialog() {
    final rid = int.tryParse(widget.residentId) ?? 0;
    final rc = TextEditingController(text: 'custom');
    final nc = TextEditingController();
    final tc = TextEditingController();
    showDialog(context: context, builder: (ctx) {
      return AlertDialog(
        backgroundColor: ref.read(currentThemeProvider).surface,
        title: Text(sduiStr('createAgentTitle', 'Spawn Agent')),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: rc, decoration: const InputDecoration(labelText: 'Role', hintText: 'security_auditor / test_engineer / custom'), style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
          const SizedBox(height: 12),
          TextField(controller: nc, decoration: const InputDecoration(labelText: 'Name (optional)'), style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
          const SizedBox(height: 12),
          TextField(controller: tc, decoration: const InputDecoration(labelText: 'Task'), maxLines: 3, style: TextStyle(color: ref.read(currentThemeProvider).textPrimary)),
        ]),
        actions: [
          TextButton(onPressed: () {
            rc.dispose(); nc.dispose(); tc.dispose();
            Navigator.pop(ctx);
          }, child: const Text('Cancel')),
          TextButton(onPressed: () {
            ref.read(residentProvider.notifier).createAgent(residentId: rid, role: rc.text, name: nc.text.isEmpty ? null : nc.text, task: tc.text);
            rc.dispose(); nc.dispose(); tc.dispose();
            Navigator.pop(ctx);
          }, child: Text('Create', style: TextStyle(color: ref.read(currentThemeProvider).primary))),
        ],
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final title = sduiStr('title', _resident?.name ?? 'Resident');
    final tab1 = sduiStr('tab1', 'Timeline');
    final tab2 = sduiStr('tab2', 'Mentor');

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        extendBodyBehindAppBar: true,
        backgroundColor: theme.background,
        appBar: AppBar(
          backgroundColor: Colors.transparent, elevation: 0,
          title: Text(title, style: TextStyle(color: theme.textPrimary, fontSize: 20, fontWeight: FontWeight.bold)),
          actions: _resident != null && _resident!.isActive ? [
            IconButton(icon: const Icon(Icons.auto_awesome_outlined, color: Colors.amberAccent), onPressed: _showCreateAgentDialog, tooltip: 'Wisdom'),
            IconButton(icon: Icon(Icons.add_task_rounded, color: theme.primary), onPressed: _showCreateAgentDialog, tooltip: 'Spawn Agent'),
            IconButton(icon: const Icon(Icons.music_note, color: Colors.green), onPressed: _showScore, tooltip: 'Sheet Music'),
          ] : null,
          bottom: _resident != null ? TabBar(indicatorColor: theme.primary, labelColor: theme.primary, unselectedLabelColor: theme.textTertiary, tabs: [Tab(text: tab1), Tab(text: tab2)]) : null,
        ),
        body: _loading ? const Center(child: CircularProgressIndicator())
          : _resident == null ? Center(child: Text('Resident not found', style: TextStyle(color: theme.textSecondary)))
          : Container(
              decoration: BoxDecoration(gradient: LinearGradient(colors: [theme.background, theme.surface], begin: Alignment.topCenter, end: Alignment.bottomCenter)),
              child: SafeArea(child: TabBarView(children: [
                CustomScrollView(slivers: [
                  ResidentProfile(theme: theme, resident: _resident!),
                  ResidentFamily(theme: theme, resident: _resident!, children: _children),
                  ResidentAgents(theme: theme, agents: _agents),
                  ResidentTimeline(theme: theme, activities: _resident!.activities),
                ]),
                ResidentMentor(theme: theme, conversations: ref.watch(sageProvider).valueOrNull ?? [], onReply: (r) => _showReplyDialog(r), onAskWisdom: _showCreateAgentDialog),
              ])),
            ),
        floatingActionButton: _resident != null && _resident!.isActive
          ? Column(mainAxisSize: MainAxisSize.min, children: [
              FloatingActionButton.small(heroTag: 'child', onPressed: () {}, backgroundColor: theme.success.withValues(alpha: 0.8), child: const Icon(Icons.family_restroom_rounded, color: Colors.white)),
              const SizedBox(height: 12),
              FloatingActionButton.extended(heroTag: 'agent', onPressed: _showCreateAgentDialog, backgroundColor: theme.primary, icon: const Icon(Icons.add_task_rounded, color: Colors.white), label: const Text('\u6D3E\u51FA Agent', style: TextStyle(color: Colors.white))),
            ]) : null,
      ),
    );
  }

  void _showReplyDialog(SageRecord record) {
    final controller = TextEditingController();
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Reply'), content: TextField(controller: controller, autofocus: true, decoration: const InputDecoration(hintText: 'Enter reply...')), actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
        TextButton(onPressed: () { Navigator.pop(ctx); }, child: const Text('Send')),
      ],
    ));
    controller.dispose();
  }
}

// =============================================================================
// settings_screen.dart
// =============================================================================

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> with SduiPageState {
  @override
  String get sduiPage => 'settings';

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final themeMode = ref.watch(themeModeProvider);
    if (sduiLayout['sections'] is List) {
      return SettingsSduiView(layout: sduiLayout, theme: theme, onAction: _handleAction);
    }
    return SettingsHardcodedView(theme: theme, themeMode: themeMode);
  }

  void _handleAction(String action) {
    if (action == 'theme') {
      Navigator.pushNamed(context, '/theme');
    } else if (action.startsWith('navigate:')) {
      Navigator.pushNamed(context, action.substring(9));
    }
  }
}

// =============================================================================
// task_detail_header.dart
// =============================================================================

}

// =============================================================================
// theme_selector_screen.dart
// =============================================================================

class ThemeSelectorScreen extends ConsumerStatefulWidget {
  const ThemeSelectorScreen({super.key});
  @override
  ConsumerState<ThemeSelectorScreen> createState() => _ThemeSelectorScreenState();
}

class _ThemeSelectorScreenState extends ConsumerState<ThemeSelectorScreen> with SduiPageState {
  @override
  String get sduiPage => 'theme_selector';

  @override
  Widget build(BuildContext context) {
    final currentTheme = ref.watch(currentThemeProvider);
    final currentIndex = ref.watch(currentThemeIndexProvider);
    final themeList = AppTheme.all;
    final items = themeList.asMap().entries.map((e) => {
      'index': e.key.toString(),
      'name': e.value.name,
      'color': e.value.gradientPrimary.isNotEmpty ? '#${e.value.gradientPrimary[0].value.toRadixString(16).padLeft(8, '0').substring(2)}' : '#7C4DFF',
      'isSelected': (e.key == currentIndex).toString(),
    }).toList();

    final layout = {'type': 'column', 'children': <Map>[
      {'type': 'for_each', 'items': 'items', 'template': {
        'type': 'card', 'margin': 8, 'child': {
          'type': 'list_tile',
          'leadingIcon': 'check',
          'leadingIconColor': '{{isSelected == true ? color : #9E9E9E}}',
          'title': '{{name}}',
          'action': 'select_{{index}}',
        },
      }},
    ]};

    final parser = SduiParser(onAction: (a) {
      if (a.startsWith('select_')) {
        final idx = int.tryParse(a.substring(7)) ?? 0;
        ref.read(currentThemeIndexProvider.notifier).state = idx;
      }
    }, vars: {'items': items});

    return Scaffold(
      backgroundColor: currentTheme.background,
      appBar: AppBar(
        backgroundColor: currentTheme.surface,
        title: Text(sduiStr('title', '\u4E3B\u9898\u8BBE\u7F6E'), style: TextStyle(color: currentTheme.textPrimary)),
        leading: IconButton(icon: Icon(Icons.arrow_back, color: currentTheme.textPrimary), onPressed: () => Navigator.pop(context)),
      ),
      body: parser.parse(layout) ?? ListView.builder(
        padding: const EdgeInsets.all(16), itemCount: themeList.length,
        itemBuilder: (context, index) {
          final theme = themeList[index];
          final isSelected = index == currentIndex;
          return Card(margin: const EdgeInsets.only(bottom: 12), color: theme.surface, child: ListTile(
            leading: Container(width: 40, height: 40, decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary, begin: Alignment.topLeft, end: Alignment.bottomRight), borderRadius: BorderRadius.circular(8))),
            title: Text(theme.name, style: TextStyle(color: theme.textPrimary, fontWeight: isSelected ? FontWeight.bold : FontWeight.normal)),
            subtitle: Text('${theme.gradientPrimary.length} colors', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
            trailing: isSelected ? Icon(Icons.check_circle, color: theme.success) : const SizedBox(),
            onTap: () => ref.read(currentThemeIndexProvider.notifier).state = index,
          ));
        },
      ),
    );
  }
}
