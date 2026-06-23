import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' hide log;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sdui_engine/sdui_engine.dart' show SduiParser;

import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/audio.dart';
import '../../core/audio/audio_engine.dart';
import '../../core/models/chat_message.dart';
import '../../core/sdui_config.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import '../components/resident/resident.dart';
import '../widgets/common/animated_dots.dart';
import '../widgets/common/markdown_text.dart';

// =============================================================================
// chat_bubble.dart
// =============================================================================

class ChatBubble extends StatelessWidget {
  final ChatMessage message;
  final AppTheme theme;
  final Map<String, dynamic> layout;
  final VoidCallback onPlayVoice;
  final bool isPlaying;
  final int? durationMs;

  const ChatBubble({
    super.key,
    required this.message,
    required this.theme,
    required this.layout,
    required this.onPlayVoice,
    this.isPlaying = false,
    this.durationMs,
  });

  @override
  Widget build(BuildContext context) {
    final isMe = message.isMe;
    final isVoice = message.isVoice;
    final isError = message.isError;
    final reasoning = message.reasoning;
    final bc = layout['bubble'] as Map? ?? {};
    final selfColor = bc['selfColor'] as String?;
    final otherColor = bc['otherColor'] as String?;
    final radius = (bc['radius'] as num?)?.toDouble() ?? 20;
    final selfBg = selfColor != null ? Color(int.parse(selfColor.replaceAll('#', '0xFF'))) : null;
    final otherBg = otherColor != null ? Color(int.parse(otherColor.replaceAll('#', '0xFF'))) : null;
    final fg = isMe ? Colors.white : (isError ? const Color(0xFFFF6B6B) : theme.textPrimary);
    final maxBubbleWidth = MediaQuery.of(context).size.width * 0.75;
    final selfGradient = selfBg == null ? LinearGradient(
      colors: theme.gradientPrimary,
      begin: Alignment.topLeft,
      end: Alignment.bottomRight,
    ) : null;
    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxBubbleWidth),
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            gradient: selfGradient,
            color: isMe ? selfBg : (otherBg ?? theme.surface.withValues(alpha: 0.7)),
            borderRadius: BorderRadius.circular(radius).copyWith(
              bottomRight: isMe ? const Radius.circular(5) : null,
              bottomLeft: !isMe ? const Radius.circular(5) : null,
            ),
            border: !isMe ? Border.all(
              color: theme.textTertiary.withValues(alpha: 0.12),
              width: 0.6,
            ) : null,
            boxShadow: [
              BoxShadow(
                color: isMe
                    ? theme.primary.withValues(alpha: 0.25)
                    : Colors.black.withValues(alpha: 0.15),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (!isVoice) ...[
              if (reasoning != null && !isMe)
                Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.fromLTRB(10, 6, 10, 8),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: 0.20),
                    borderRadius: BorderRadius.circular(8),
                    border: Border(
                      left: BorderSide(color: theme.primary.withValues(alpha: 0.5), width: 2),
                    ),
                  ),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Icon(Icons.psychology_outlined, color: theme.textTertiary.withValues(alpha: 0.7), size: 10),
                      const SizedBox(width: 4),
                      Text('思考', style: TextStyle(color: theme.textTertiary.withValues(alpha: 0.7), fontSize: 9, fontWeight: FontWeight.w500, letterSpacing: 0.5)),
                    ]),
                    const SizedBox(height: 4),
                    Text(reasoning, style: TextStyle(color: theme.textTertiary.withValues(alpha: 0.6), fontSize: 11, fontStyle: FontStyle.italic, height: 1.35)),
                  ]),
                ),
              GestureDetector(
                onLongPress: () {
                  if (message.text.isEmpty) return;
                  Clipboard.setData(ClipboardData(text: message.text));
                  ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('已复制'), duration: Duration(milliseconds: 800)));
                },
                child: MarkdownText(source: message.text, base: TextStyle(color: fg, fontSize: 14)),
              ),
            ]
            else
              GestureDetector(
                onTap: onPlayVoice,
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: isPlaying ? Colors.white.withValues(alpha: 0.3) : Colors.white.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(isPlaying ? Icons.pause : Icons.play_arrow, color: isMe ? Colors.white : theme.primary, size: 18),
                  ),
                  const SizedBox(width: 8),
                  Text('\u8BED\u97F3', style: TextStyle(color: fg, fontSize: 14)),
                  if (durationMs != null) ...[
                    const Spacer(),
                    Text('${(durationMs! / 1000).toStringAsFixed(1)}\u2033', style: TextStyle(color: isMe ? Colors.white.withValues(alpha: 0.85) : theme.textTertiary, fontSize: 12)),
                  ],
                ]),
              ),
            const SizedBox(height: 6),
            Row(mainAxisSize: MainAxisSize.min, children: [
              Text(message.time, style: TextStyle(color: isMe ? Colors.white.withValues(alpha: 0.75) : theme.textTertiary, fontSize: 10)),
              if (!isMe && message.hash != null) ...[
                const SizedBox(width: 6),
                Container(width: 2, height: 2, decoration: BoxDecoration(color: theme.textTertiary.withValues(alpha: 0.4), shape: BoxShape.circle)),
                const SizedBox(width: 6),
                Text(message.hash!, style: TextStyle(color: theme.textTertiary.withValues(alpha: 0.5), fontSize: 8, fontFamily: 'monospace', letterSpacing: 0.3)),
              ],
            ]),
          ]),
        ),
      ),
    );
  }
}

// =============================================================================
// chat_empty_state.dart
// =============================================================================

class ChatEmptyState extends StatelessWidget {
  final AppTheme theme;
  final Map<String, dynamic> layout;
  const ChatEmptyState({super.key, required this.theme, required this.layout});

  @override
  Widget build(BuildContext context) {
    final es = layout['emptyState'] as Map?;
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
}

// =============================================================================
// chat_input_area.dart
// =============================================================================

class ChatInputArea extends StatelessWidget {
  final AppTheme theme;
  final TextEditingController controller;
  final Map<String, dynamic> layout;
  final bool recording;
  final bool hasText;
  final VoidCallback onSend;
  final VoidCallback onStartRecord;
  final VoidCallback onEndRecord;
  final ValueChanged<String> onTextChanged;

  const ChatInputArea({
    super.key,
    required this.theme,
    required this.controller,
    required this.layout,
    required this.recording,
    required this.hasText,
    required this.onTextChanged,
    required this.onSend,
    required this.onStartRecord,
    required this.onEndRecord,
  });

  @override
  Widget build(BuildContext context) {
    final ia = layout['input'] as Map? ?? {};
    final hint = ia['hint'] as String? ?? '\u8F93\u5165\u6D88\u606F...';
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.85),
        border: Border(top: BorderSide(color: theme.textTertiary.withValues(alpha: 0.08), width: 1)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 12,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
        Container(
          margin: const EdgeInsets.only(right: 4, bottom: 2),
          child: IconButton(
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
            icon: Icon(Icons.add_circle_outline, color: theme.textSecondary, size: 24),
            onPressed: () {},
          ),
        ),
        Expanded(
          child: Container(
            constraints: const BoxConstraints(minHeight: 40, maxHeight: 120),
            decoration: BoxDecoration(
              color: theme.background.withValues(alpha: 0.6),
              borderRadius: BorderRadius.circular(22),
              border: Border.all(
                color: hasText ? theme.primary.withValues(alpha: 0.4) : theme.textTertiary.withValues(alpha: 0.1),
                width: 1,
              ),
            ),
            child: TextField(
              controller: controller,
              style: TextStyle(color: theme.textPrimary, fontSize: 14.5, height: 1.35),
              maxLines: 4,
              minLines: 1,
              textInputAction: TextInputAction.newline,
              keyboardType: TextInputType.multiline,
              decoration: InputDecoration(
                hintText: hint,
                hintStyle: TextStyle(color: theme.textTertiary.withValues(alpha: 0.7), fontSize: 14.5),
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                isDense: true,
              ),
              onChanged: onTextChanged,
            ),
          ),
        ),
        const SizedBox(width: 8),
        AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
          margin: const EdgeInsets.only(bottom: 2),
          child: GestureDetector(
            onLongPressStart: (_) => onStartRecord(),
            onLongPressEnd: (_) => onEndRecord(),
            onLongPressCancel: () => onEndRecord(),
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: recording ? theme.error : null,
                gradient: recording ? null : (hasText ? null : LinearGradient(colors: theme.gradientPrimary, begin: Alignment.topLeft, end: Alignment.bottomRight)),
                borderRadius: BorderRadius.circular(20),
                boxShadow: recording
                    ? [BoxShadow(color: theme.error.withValues(alpha: 0.5), blurRadius: 12, spreadRadius: 1)]
                    : (hasText ? null : [BoxShadow(color: theme.primary.withValues(alpha: 0.3), blurRadius: 8, offset: const Offset(0, 2))]),
              ),
              child: Icon(
                recording ? Icons.stop_rounded : (hasText ? Icons.keyboard_voice : Icons.mic_none),
                color: Colors.white,
                size: 20,
              ),
            ),
          ),
        ),
        if (hasText) ...[
          const SizedBox(width: 6),
          GestureDetector(
            onTap: onSend,
            child: Container(
              width: 40,
              height: 40,
              margin: const EdgeInsets.only(bottom: 2),
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: theme.gradientPrimary, begin: Alignment.topLeft, end: Alignment.bottomRight),
                borderRadius: BorderRadius.circular(20),
                boxShadow: [BoxShadow(color: theme.primary.withValues(alpha: 0.4), blurRadius: 10, offset: const Offset(0, 2))],
              ),
              child: const Icon(Icons.send_rounded, color: Colors.white, size: 18),
            ),
          ),
        ],
      ])),
    );
  }
}

// =============================================================================
// chat_voice_player.dart
// =============================================================================

// === invariants ===
// - _currentPlayer 同一时间只播一个音频，新 playKey 会停旧的
// - _processor 生命周期 = class 生命周期，dispose 时释放

class ChatVoicePlayer {
  AudioPlayer? _currentPlayer;
  LmdnProcessor? _processor;
  QiniuDirectClient? _client;
  String? _currentKey;
  void Function(String? key, int durationMs)? onStateChange;

  String? get currentKey => _currentKey;

  Future<void> dispose() async {
    await _currentPlayer?.stop();
    _currentPlayer?.dispose();
    _currentPlayer = null;
    _processor?.dispose();
    _processor = null;
  }

  Future<void> playKey(String key, {LmdnProcessor? codec}) async {
    if (_currentPlayer == null) _currentPlayer = AudioPlayer();
    await _currentPlayer!.stop();
    try {
      final client = await _getClient();
      log('[C14] downloading key=$key');
      final raw = await client.getBinary(key);
      if (raw == null || raw.isEmpty) {
        log('[C14] empty response');
        return;
      }
      log('[C14] raw ${raw.length} B');
      final proc = codec ?? _processor;
      if (proc == null) {
        final cfg = await LmdnConfig.load();
        _processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: false, enableCodec: true);
        await _processor!.initialize();
      }
      final decoded = await (codec ?? _processor)!.processReceivedAudio(raw);
      if (decoded != null && decoded.pcm.isNotEmpty) {
        log('[C14] decoded ${decoded.pcm.length} B');
        final cfg = await LmdnConfig.load();
        final durationMs = (decoded.pcm.length / (cfg.sampleRate * 2) * 1000).round();
        final wav = QiniuDirectClient.wavFromPcm(decoded.pcm, sampleRate: cfg.sampleRate);
        _currentKey = key;
        onStateChange?.call(key, durationMs);
        await _currentPlayer!.play(BytesSource(wav));
        _currentPlayer!.onPlayerComplete.first.then((_) {
          if (_currentKey == key) {
            _currentKey = null;
            onStateChange?.call(null, 0);
          }
        });
      }
    } catch (e) {
      log('[C14] error: $e');
    }
  }

  Future<QiniuDirectClient> _getClient() async {
    if (_client != null) return _client!;
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'play_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
    _client = QiniuDirectClient(peerId: pid);
    await _client!.register();
    return _client!;
  }
}

// =============================================================================
// chat_voice_recorder.dart
// =============================================================================

// === invariants ===
// - _vmBuffer 只在 startRecord/stopRecord 间由 stream.listen 追加
// - stopRecord 后 _vmBuffer.clear()，防止残留
// - 同一时刻只有一个录音流在运行（_vmRecording 守卫）

class ChatVoiceRecorder {
  QiniuDirectClient? _client;
  AudioRecorder? _recorder;
  LmdnProcessor? _processor;
  StreamSubscription? _sub;
  final List<int> _vmBuffer = [];
  bool _vmRecording = false;

  Future<void> dispose() async {
    _sub?.cancel();
    _sub = null;
    _recorder?.dispose();
    _recorder = null;
    _processor?.dispose();
    _processor = null;
    _client?.dispose();
    _client = null;
    _vmBuffer.clear();
    _vmRecording = false;
  }

  Future<bool> startRecord() async {
    if (_vmRecording) return false;
    _vmBuffer.clear();
    try {
      if (_recorder == null) _recorder = AudioRecorder();
      if (_processor == null) {
        final cfg = await LmdnConfig.load();
        _processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: false, enableCodec: true);
        await _processor!.initialize();
      }
      if (await _recorder!.hasPermission() != true) {
        await _recorder!.hasPermission(request: true);
        if (await _recorder!.hasPermission() != true) {
          log('[C10] mic denied');
          return false;
        }
      }
      final sr = _processor!.sampleRate;
      final stream = await _recorder!.startStream(RecordConfig(
        encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: sr));
      if (stream == null) {
        log('[C10] stream null');
        return false;
      }
      _vmRecording = true;
      log('[C10] recording start sr=$sr');
      _sub = stream.listen((chunk) {
        _vmBuffer.addAll(chunk);
      }, onError: (e) {
        log('[C10] stream error: $e');
        _vmRecording = false;
      });
      return true;
    } catch (e) {
      log('[C10] init error: $e');
      return false;
    }
  }

  Future<String?> stopRecord({required String chatId}) async {
    if (!_vmRecording) return null;
    _vmRecording = false;
    await _sub?.cancel();
    _sub = null;
    await _recorder?.stop();
    if (_vmBuffer.isEmpty) {
      log('[C11] empty buffer');
      return null;
    }
    final pcm = Uint8List.fromList(_vmBuffer);
    _vmBuffer.clear();
    log('[C11] raw pcm ${pcm.length} B');
    try {
      final encoded = await _processor?.processMicrophoneInput(pcm);
      if (encoded == null) {
        log('[C11] encode fail');
        return null;
      }
      log('[C11] encoded ${pcm.length} -> ${encoded.length} B');
      final client = await _getClient();
      final ts = DateTime.now().millisecondsSinceEpoch;
      final key = 'oc/chat/$chatId/$ts.enc';
      await client.putBinary(key, encoded);
      log('[C12] uploaded key=$key');
      return key;
    } catch (e) {
      log('[C11/C12] error: $e');
      return null;
    }
  }

  Future<QiniuDirectClient> _getClient() async {
    if (_client != null) return _client!;
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'rec_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
    _client = QiniuDirectClient(peerId: pid);
    await _client!.register();
    return _client!;
  }
}

// =============================================================================
// voice_room_screen.dart
// =============================================================================

class VoiceRoomScreen extends ConsumerStatefulWidget {
  const VoiceRoomScreen({super.key});

  @override
  ConsumerState<VoiceRoomScreen> createState() => _VoiceRoomScreenState();
}

class _VoiceRoomScreenState extends ConsumerState<VoiceRoomScreen>
    with SduiPageState {
  QiniuDirectClient? _client;
  String? _targetPeerId;
  String _state = 'calling';
  Timer? _signalTimer;
  bool _muted = false;
  bool _isSelfTest = false;
  bool _vmMode = false;
  final List<ScoreNote> _allNotes = [];
  final Map<String, void Function()> _customActions = {};
  VoiceUiConfig _uiVoice = const VoiceUiConfig();
  late final AudioEngine _audio;
  bool _ended = false;

  @override
  String get sduiPage => 'voice';

  @override
  void initState() {
    super.initState();
    final args = ModalRoute.of(context)?.settings.arguments;
    final argMap = args is Map ? Map<String, dynamic>.from(args) : {};
    _targetPeerId = argMap['targetPeerId'] as String?;
    _client = argMap['client'] as QiniuDirectClient?;

    _audio = AudioEngine(
      cfg: const AudioEngineConfig(
        roomId: '',
        vmRecordEnabled: true,
        localModeEnabled: true,
        callFramesEnabled: true,
        notesEnabled: true,
      ),
      onNotes: (notes) { if (mounted) setState(() {}); },
      externalClient: _client,
    );
    _audio.targetPeerId = _targetPeerId;
    _audio.notes = _allNotes;

    VoiceUiConfig.load().then((c) {
      if (mounted) setState(() => _uiVoice = c);
    });

    if (_targetPeerId != null && _client != null) {
      log('[C1] target=$_targetPeerId');
      _signalTimer = Timer.periodic(const Duration(seconds: 2), (_) => _pollResponse());
    }

    if (argMap['selfTest'] == 'true') {
      _isSelfTest = true;
      _initSelfTest();
    }
  }

  @override
  void dispose() {
    _audio.leave();
    _signalTimer?.cancel();
    if (_isSelfTest) _client?.dispose();
    super.dispose();
  }

  Future<void> _initSelfTest() async {
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ??
        '${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999).toString().padLeft(5, '0')}';
    if (_client == null) {
      _client = QiniuDirectClient(peerId: pid);
      _audio.client = _client;
    }
    if (_client == null) return;
    _signalTimer?.cancel();
    await _client!.register();
    log('[C1] registered peer=${_client!.peerId}');
    _targetPeerId = _client!.peerId;
    _audio.targetPeerId = _targetPeerId;
    if (mounted) setState(() => _state = 'calling');
  }

  Future<void> _pollResponse() async {
    if (_state == 'ended' || _client == null) return;
    try {
      final signals = await _client!.pollIncoming();
      for (final s in signals) {
        final action = s['action'] as String?;
        final from = s['fromPeerId'] as String?;
        if (action == 'call-accept' && from == _targetPeerId) {
          if (mounted) setState(() => _state = 'connected');
          _audio.state = 'connected';
          await _audio.start();
          return;
        }
        if (action == 'call-end' && from == _targetPeerId) {
          _endCall();
          return;
        }
      }
    } catch (e) {
      log('_pollResponse: $e');
    }
  }

  void _acceptCall() {
    if (_targetPeerId == null) return;
    _client?.sendSignal(_targetPeerId!, 'call-accept');
    if (mounted) setState(() => _state = 'connected');
    _audio.state = 'connected';
    _audio.start();
  }

  void _endCall() {
    if (_ended) return;
    _ended = true;
    _audio.clearLocalQueue();
    _saveEpc();
    if (_targetPeerId != null) _client?.sendSignal(_targetPeerId!, 'call-end');
    if (mounted) setState(() => _state = 'ended');
    _signalTimer?.cancel();
    if (mounted && Navigator.canPop(context)) Navigator.pop(context);
  }

  Future<void> _saveEpc() async {
    if (_audio.callFrames.isEmpty) {
      log('[C9] no frames to save');
      return;
    }
    try {
      int total = _audio.callFrames.fold(0, (s, f) => s + f.length);
      final epc = Uint8List(total);
      int off = 0;
      for (final f in _audio.callFrames) {
        epc.setRange(off, off + f.length, f);
        off += f.length;
      }
      _audio.callFrames.clear();
      await _client?.saveEpcRecord(epc);
      log('[C9] saved epc ${epc.length} B');
    } catch (e) {
      log('[C9] error: $e');
    }
  }

  void _startVmRecord() {
    _audio.startVmRecord().then((_) {
      if (mounted) setState(() {});
    });
  }

  void _endVmRecord() {
    _audio.endVmRecord().then((_) {
      if (mounted) setState(() {});
    });
  }

  void _handleAction(String action) {
    if (_customActions.containsKey(action)) {
      _customActions[action]!();
      return;
    }
    switch (action) {
      case 'hangup':
        _endCall();
        break;
      case 'toggle_mute':
        if (mounted) setState(() {
          _muted = !_muted;
          _audio.muted = _muted;
        });
        break;
      case 'accept_call':
        _acceptCall();
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    final stateText = _state == 'calling' ? _uiVoice.calling(_targetPeerId ?? '') :
        _state == 'ringing' ? _uiVoice.ringingText :
        _state == 'connected' ? _uiVoice.connected(_targetPeerId ?? '') : _uiVoice.endedText;

    final statusLabel = _state == 'connected'
        ? (_muted ? _uiVoice.mutedLabel : _uiVoice.relayLabel)
        : '';
    final muteIcon = _muted ? 'mic_off' : 'mic';

    if (_isSelfTest && _state == 'calling' && !_vmMode) {
      return VoiceRoomModeSelect(
        theme: theme,
        onStartCall: () {
          setState(() => _state = 'connected');
          _audio.state = 'connected';
          _audio.start();
        },
        onStartVoiceMsg: () => setState(() {
          _vmMode = true;
          _state = 'voiceMessage';
        }),
      );
    }

    if (_state == 'voiceMessage' && _vmMode) {
      return VoiceRoomVmScreen(
        theme: theme,
        recording: _audio.vmRecording,
        onPointerDown: _startVmRecord,
        onPointerUp: _endVmRecord,
        onBack: () {
          if (mounted) setState(() { _vmMode = false; _state = 'calling'; });
        },
      );
    }

    final stateLayout = sduiLayout[_state] as Map?;
    if (stateLayout != null) {
      final parser = SduiParser(
        onAction: _handleAction,
        vars: {
          'statusText': stateText,
          'statusLabel': statusLabel,
          'muteIcon': muteIcon,
          'connected': _state == 'connected',
          'calling': _state == 'calling',
          'ringing': _state == 'ringing',
        },
      );
      final widget = parser.parse(stateLayout);
      if (widget != null) {
        return Scaffold(
          backgroundColor: theme.background,
          body: SafeArea(child: widget),
        );
      }
    }

    return _buildDefaultUI(theme, stateText, statusLabel);
  }

// === invariants ===
// - _state 单向流转: calling → connected/voiceMessage → ended
// - _ended 单调 false→true，避免重复 _endCall
// - _audio.leave() 在 dispose() 中调用，释放录音/播放/定时器
// - _signalTimer 在 dispose() 中 cancel
// - [C1] 在 initState（非 selfTest 路径）和 _initSelfTest 中均打印

  Widget _buildDefaultUI(AppTheme theme, String stateText, String statusLabel) {
    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(),
            const Icon(Icons.mic_rounded, size: 48, color: Colors.white),
            const SizedBox(height: 24),
            Text(stateText, style: TextStyle(color: theme.textPrimary, fontSize: 20, fontWeight: FontWeight.w600)),
            if (_state == 'connected')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(statusLabel, style: TextStyle(color: theme.textTertiary, fontSize: 12)),
              ),
            if (_state == 'connected' && _allNotes.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: SizedBox(
                  height: 160,
                  child: ResidentMusicScore(
                    title: _uiVoice.connected(_targetPeerId ?? ''),
                    notes: List.from(_allNotes),
                    bpm: 120,
                  ),
                ),
              ),
            const SizedBox(height: 32),
            if (_state == 'calling')
              VoiceRoomCtrlBtn(icon: Icons.call_end, color: theme.error, onTap: _endCall, big: true),
            if (_state == 'connected')
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                VoiceRoomCtrlBtn(
                  icon: _muted ? Icons.mic_off : Icons.mic,
                  color: theme.primary,
                  onTap: () => setState(() {
                    _muted = !_muted;
                    _audio.muted = _muted;
                  }),
                ),
                const SizedBox(width: 16),
                VoiceRoomCtrlBtn(
                  icon: _audio.localMode ? Icons.storage : Icons.cloud_upload,
                  color: _audio.localMode ? theme.textPrimary : theme.primary,
                  onTap: () => setState(() {
                    _audio.localMode = !_audio.localMode;
                    if (!_audio.localMode) _audio.localQueue.clear();
                  }),
                ),
                const SizedBox(width: 16),
                VoiceRoomCtrlBtn(icon: Icons.call_end, color: theme.error, onTap: _endCall, big: true),
              ]),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}

// =============================================================================
// voice_room_widgets.dart
// =============================================================================

/// Reusable button widget for voice room control bar.
class VoiceRoomCtrlBtn extends StatelessWidget {
  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final bool big;
  final String? label;

  const VoiceRoomCtrlBtn({
    super.key,
    required this.icon,
    required this.color,
    required this.onTap,
    this.big = false,
    this.label,
  });

  @override
  Widget build(BuildContext context) {
    if (label != null) {
      return GestureDetector(
        onTap: onTap,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: big ? 72 : 56,
            height: big ? 72 : 56,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(big ? 24 : 18),
              border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
            ),
            child: Icon(icon, color: Colors.white, size: big ? 32 : 24),
          ),
          const SizedBox(height: 8),
          Text(label!, style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 12)),
        ]),
      );
    }
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: big ? 72 : 56,
        height: big ? 72 : 56,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(big ? 24 : 18),
          border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
        ),
        child: Icon(icon, color: Colors.white, size: big ? 32 : 24),
      ),
    );
  }
}

/// Self-test mode selection screen (实时通话 vs 语音消息).
class VoiceRoomModeSelect extends StatelessWidget {
  final AppTheme theme;
  final VoidCallback onStartCall;
  final VoidCallback onStartVoiceMsg;

  const VoiceRoomModeSelect({
    super.key,
    required this.theme,
    required this.onStartCall,
    required this.onStartVoiceMsg,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(),
            const Icon(Icons.mic_rounded, size: 64, color: Colors.white),
            const SizedBox(height: 24),
            Text('\u9009\u62E9\u6A21\u5F0F',
                style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.w600)),
            const SizedBox(height: 48),
            VoiceRoomCtrlBtn(
              icon: Icons.headset,
              color: theme.primary,
              onTap: onStartCall,
              label: '\u5B9E\u65F6\u901A\u8BDD',
            ),
            const SizedBox(height: 24),
            VoiceRoomCtrlBtn(
              icon: Icons.send_rounded,
              color: theme.textPrimary,
              onTap: onStartVoiceMsg,
              label: '\u8BED\u97F3\u6D88\u606F',
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}

/// Voice message recording UI (按住说话).
class VoiceRoomVmScreen extends StatelessWidget {
  final AppTheme theme;
  final bool recording;
  final VoidCallback onPointerDown;
  final VoidCallback onPointerUp;
  final VoidCallback onBack;

  const VoiceRoomVmScreen({
    super.key,
    required this.theme,
    required this.recording,
    required this.onPointerDown,
    required this.onPointerUp,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(),
            Icon(recording ? Icons.mic : Icons.mic_none, size: 64,
                color: recording ? theme.error : theme.textPrimary),
            const SizedBox(height: 24),
            Text(recording ? '\u5F55\u97F3\u4E2D...' : '\u6309\u4F4F\u8BF4\u8BDD',
                style: TextStyle(color: theme.textPrimary, fontSize: 20)),
            const SizedBox(height: 48),
            Listener(
              onPointerDown: (_) => onPointerDown(),
              onPointerUp: (_) => onPointerUp(),
              onPointerCancel: (_) => onPointerUp(),
              child: Container(
                width: 120, height: 120,
                decoration: BoxDecoration(
                  color: recording ? theme.error.withValues(alpha: 0.3) : theme.primary.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(60),
                  border: Border.all(
                      color: recording ? theme.error : theme.primary, width: 2),
                ),
                child: Icon(Icons.mic, size: 48,
                    color: recording ? theme.error : theme.textPrimary),
              ),
            ),
            const SizedBox(height: 48),
            TextButton(
              onPressed: onBack,
              child: Text('\u8FD4\u56DE', style: TextStyle(color: theme.textTertiary)),
            ),
            const Spacer(),
          ],
        ),
      ),
    );
  }
}
