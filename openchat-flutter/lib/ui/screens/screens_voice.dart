import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' hide log;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sdui_engine/sdui_engine.dart' show SduiParser;

import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/audio.dart';
import '../../core/sdui_config.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import '../components/resident/resident.dart';

// =============================================================================
// chat_bubble.dart
// =============================================================================

class ChatBubble extends StatelessWidget {
  final Map<String, dynamic> message;
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
    final isMe = message['sender'] == 'me';
    final isVoice = message['type'] == 'voice';
    final isError = message['isError'] == true;
    final reasoning = message['reasoning'] as String?;
    final bc = layout['bubble'] as Map? ?? {};
    final selfColor = bc['selfColor'] as String?;
    final otherColor = bc['otherColor'] as String?;
    final radius = (bc['radius'] as num?)?.toDouble() ?? 20;
    final selfBg = selfColor != null ? Color(int.parse(selfColor.replaceAll('#', '0xFF'))) : null;
    final otherBg = otherColor != null ? Color(int.parse(otherColor.replaceAll('#', '0xFF'))) : null;
    final fg = isMe ? Colors.white : (isError ? const Color(0xFFFF6B6B) : theme.textPrimary);
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
          if (!isVoice) ...[
            if (reasoning != null && !isMe)
              Container(
                margin: const EdgeInsets.only(bottom: 6),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('思考', style: TextStyle(color: theme.textTertiary.withValues(alpha: 0.6), fontSize: 9, fontWeight: FontWeight.w500)),
                  const SizedBox(height: 2),
                  Text(reasoning, style: TextStyle(color: theme.textTertiary.withValues(alpha: 0.5), fontSize: 11, fontStyle: FontStyle.italic)),
                ]),
              ),
            Text(message['text'] ?? '', style: TextStyle(color: fg, fontSize: 14)),
          ]
          else
            GestureDetector(
              onTap: onPlayVoice,
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(isPlaying ? Icons.pause : Icons.play_arrow, color: isMe ? Colors.white : theme.primary, size: 20),
                const SizedBox(width: 6),
                Text('\u8BED\u97F3', style: TextStyle(color: fg, fontSize: 14)),
                if (durationMs != null) ...[
                  const Spacer(),
                  Text('${(durationMs! / 1000).toStringAsFixed(1)}\u2033', style: TextStyle(color: isMe ? Colors.white.withValues(alpha: 0.85) : theme.textTertiary, fontSize: 12)),
                ],
              ]),
            ),
          const SizedBox(height: 4),
          Text(message['time'] ?? '', style: TextStyle(color: isMe ? Colors.white.withValues(alpha: 0.7) : theme.textTertiary, fontSize: 10)),
          if (!isMe && message['hash'] != null)
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Text(message['hash'] as String, style: TextStyle(color: theme.textTertiary.withValues(alpha: 0.5), fontSize: 8, fontFamily: 'monospace')),
            ),
        ]),
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
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        border: Border(top: BorderSide(color: theme.textTertiary.withValues(alpha: 0.1), width: 1))),
      child: SafeArea(child: Row(children: [
        IconButton(icon: Icon(Icons.add_circle_outline, color: theme.textSecondary), onPressed: () {}),
        Expanded(child: TextField(
          controller: controller,
          style: TextStyle(color: theme.textPrimary),
          maxLines: 4,
          minLines: 1,
          textInputAction: TextInputAction.newline,
          keyboardType: TextInputType.multiline,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(color: theme.textTertiary),
            filled: true, fillColor: theme.background,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12)),
          onChanged: onTextChanged,
        )),
        const SizedBox(width: 4),
        GestureDetector(
          onLongPressStart: (_) => onStartRecord(),
          onLongPressEnd: (_) => onEndRecord(),
          onLongPressCancel: () => onEndRecord(),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: recording ? theme.error.withValues(alpha: 0.3) : null,
              gradient: recording ? null : LinearGradient(colors: theme.gradientPrimary),
              borderRadius: BorderRadius.circular(20)),
            child: Icon(recording ? Icons.mic : Icons.keyboard_voice, color: Colors.white, size: 20)),
        ),
        const SizedBox(width: 4),
        IconButton(
          icon: Icon(Icons.send_rounded, color: hasText ? theme.primary : theme.textTertiary),
          onPressed: hasText ? onSend : null,
        ),
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
// room_audio.dart
// =============================================================================

/// 房间音频管理：录音→编码→S3 上传；轮询→下载→解码→播放队列
class RoomAudio {
  final String roomId;
  final void Function(Set<String> participants) onParticipants;
  final void Function() onState;

  QiniuDirectClient? _client;
  AudioRecorder? _recorder;
  AudioPlayer? _player;
  LmdnProcessor? _processor;
  StreamSubscription? _recordSub;
  Timer? _audioTimer;
  int _audioSeq = 0;
  bool _muted = false;
  bool _audioStarted = false;
  bool _ended = false;
  final List<Uint8List> _playQueue = [];
  bool _playing = false;
  String _myPeerId = '';
  final Map<String, int> _playedSeqs = {};
  final Map<String, bool> _mutedPeers = {};
  final Set<String> _participants = {};

  RoomAudio({required this.roomId, required this.onParticipants, required this.onState});

  String get myPeerId => _myPeerId;
  Set<String> get participants => _participants;
  Map<String, bool> get mutedPeers => _mutedPeers;
  bool get muted => _muted;
  bool get ended => _ended;

  Future<void> start() async {
    log('[C15] room init enter');
    final pid = 'room_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
    _client = QiniuDirectClient(peerId: pid);
    await _client!.register();
    _myPeerId = _client!.peerId;
    log('[C15] room init ok peer=$_myPeerId');
    onState();
    await _startAudio();
  }

  Future<void> _startAudio() async {
    if (_audioStarted) return;
    _audioStarted = true;
    try {
      final cfg = await LmdnConfig.load();
      _recorder = AudioRecorder();
      _player = AudioPlayer();
      _processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: false, enableCodec: true);
      await _processor!.initialize();
      log('[C15] processor+player init ok');

      if (await _recorder!.hasPermission() != true) {
        await _recorder!.hasPermission(request: true);
        if (await _recorder!.hasPermission() != true) { _audioStarted = false; log('[C15] mic perm denied'); return; }
      }
      log('[C15] mic perm ok');

      final stream = await _recorder!.startStream(RecordConfig(
        encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: cfg.sampleRate));
      if (stream == null) { _audioStarted = false; log('[C15] stream null'); return; }
      log('[C15] stream started');

      final bufSize = cfg.bufferBytes;
      List<int> _buffer = [];
      _recordSub = stream.listen((chunk) async {
        try {
          if (_muted || _ended) { _buffer.clear(); return; }
          _buffer.addAll(chunk);
          if (_buffer.length >= bufSize) {
            var frame = Uint8List.fromList(_buffer.take(bufSize).toList());
            _buffer = _buffer.skip(bufSize).toList();
            final processed = await _processor?.processMicrophoneInput(frame);
            if (processed != null) {
              final key = 'oc/rooms/$roomId/$_myPeerId/${_audioSeq++}.enc';
              await _client?.putBinary(key, processed);
            }
          }
        } catch (e) { log('[C16] record error: $e'); }
      }, onError: (e) { log('[C16] stream error: $e'); });

      log('[C15] upload path oc/rooms/$roomId/$_myPeerId/');
      _audioTimer = Timer.periodic(Duration(milliseconds: cfg.pollMs), (_) => _pollRoom());
    } catch (e) {
      log('[C15] init error: $e');
      _audioStarted = false;
    }
  }

  Future<void> _pollRoom() async {
    if (_ended || _client == null) return;
    try {
      final prefix = 'oc/rooms/$roomId/';
      final allKeys = await _client!.listFiles(prefix);
      log('[C16] listFiles prefix=$prefix count=${allKeys.length}');
      final peerDirs = <String>{};
      for (final k in allKeys) {
        final parts = k.split('/');
        if (parts.length >= 4) peerDirs.add(parts[3]);
      }
      if (peerDirs.length != _participants.length) {
        _participants.addAll(peerDirs);
        onParticipants(_participants);
        log('[C16] participants updated: $peerDirs');
      }
      int fetched = 0, played = 0;
      for (final peerId in peerDirs) {
        if (peerId == _myPeerId) continue;
        if (_mutedPeers[peerId] == true) { log('[C17] skip muted peer=$peerId'); continue; }
        final lastSeq = _playedSeqs[peerId] ?? -1;
        final peerPrefix = '$prefix$peerId/';
        for (final k in allKeys) {
          if (!k.startsWith(peerPrefix)) continue;
          final seqStr = k.split('/').last.replaceAll('.enc', '');
          final seq = int.tryParse(seqStr) ?? -1;
          if (seq <= lastSeq) continue;
          fetched++;
          _playedSeqs[peerId] = seq;
          final data = await _client!.getBinary(k);
          if (data.isEmpty) { log('[C17] empty data key=$k'); continue; }
          final result = await _processor?.processReceivedAudio(data);
          if (result != null) { _playQueue.add(result.pcm); played++; }
        }
      }
      if (fetched > 0) log('[C16] poll: fetched=$fetched played=$played');
      if (!_playing && _playQueue.isNotEmpty) _playNext();
    } catch (e) {
      log('[C16] poll error: $e');
    }
  }

  Future<void> _playNext() async {
    if (_playQueue.isEmpty) { _playing = false; return; }
    _playing = true;
    try {
      const targetBytes = 3 * 48000 * 2;
      int total = 0;
      final batch = <Uint8List>[];
      while (_playQueue.isNotEmpty && total < targetBytes) {
        final chunk = _playQueue.removeAt(0);
        batch.add(chunk);
        total += chunk.length;
      }
      final pcm = Uint8List(total);
      int offset = 0;
      for (final chunk in batch) {
        pcm.setRange(offset, offset + chunk.length, chunk);
        offset += chunk.length;
      }
      final sr = _processor?.sampleRate ?? 48000;
      final wav = QiniuDirectClient.wavFromPcm(pcm, sampleRate: sr);
      final player = _player;
      if (player != null) {
        player.onPlayerComplete.first.then((_) => _playNext());
        await player.play(BytesSource(wav));
      }
    } catch (e) {
      log('room _playNext error: $e');
      _playing = false;
    }
  }

  void toggleMuteSelf() {
    _muted = !_muted;
  }

  void toggleMutePeer(String peerId) {
    _mutedPeers[peerId] = !(_mutedPeers[peerId] ?? false);
  }

  bool isPeerMuted(String peerId) => _mutedPeers[peerId] ?? false;

  void leave() {
    if (_ended) return;
    _ended = true;
    _recordSub?.cancel();
    _recorder?.dispose();
    _player?.dispose();
    _processor?.dispose();
    _audioTimer?.cancel();
    _client?.dispose();
  }
}

// =============================================================================
// room_screen.dart
// =============================================================================

class RoomScreen extends ConsumerStatefulWidget {
  final String roomId;
  const RoomScreen({super.key, required this.roomId});

  @override
  ConsumerState<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  RoomAudio? _audio;

  @override
  void initState() {
    super.initState();
    _initAudio();
  }

  void _initAudio() {
    _audio = RoomAudio(
      roomId: widget.roomId,
      onParticipants: (_) { if (mounted) setState(() {}); },
      onState: () { if (mounted) setState(() {}); },
    );
    _audio!.start();
  }

  void _leaveRoom() {
    _audio?.leave();
    if (mounted && Navigator.canPop(context)) Navigator.pop(context);
  }

  @override
  void dispose() {
    _audio?.leave();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final audio = _audio;
    if (audio == null) {
      return Scaffold(backgroundColor: theme.background);
    }
    final sortedPeers = audio.participants.where((p) => p != audio.myPeerId).toList()..sort();

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surface.withValues(alpha: 0.5),
        elevation: 0,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('\u623F\u95F4: ${widget.roomId}', style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
          Text('${audio.participants.length} \u4EBA\u5728\u7EBF', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
        ]),
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: theme.textPrimary),
          onPressed: _leaveRoom,
        ),
      ),
      body: Column(children: [
        Expanded(child: sortedPeers.isEmpty
          ? Center(child: Text('\u7B49\u5F85\u5176\u4ED6\u4EBA\u52A0\u5165...', style: TextStyle(color: theme.textTertiary, fontSize: 16)))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: sortedPeers.length + 1,
              itemBuilder: (context, index) {
                final isSelf = index == 0;
                final peerId = isSelf ? audio.myPeerId : sortedPeers[index - 1];
                final isMuted = isSelf ? audio.muted : audio.isPeerMuted(peerId);
                return Card(
                  color: theme.surface.withValues(alpha: 0.4),
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  child: ListTile(
                    leading: CircleAvatar(child: Icon(Icons.person, color: Colors.white)),
                    title: Text(isSelf ? '\u6211 ($peerId)' : peerId,
                      style: TextStyle(color: theme.textPrimary, fontSize: 14)),
                    trailing: IconButton(
                      icon: Icon(isMuted ? Icons.mic_off : Icons.mic, color: isMuted ? theme.error : theme.textSecondary),
                      onPressed: () {
                        if (isSelf) audio.toggleMuteSelf();
                        else audio.toggleMutePeer(peerId);
                        setState(() {});
                      },
                    ),
                  ),
                );
              },
            )),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surface.withValues(alpha: 0.5),
            border: Border(top: BorderSide(color: theme.textTertiary.withValues(alpha: 0.1)))),
          child: SafeArea(child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
            IconButton(
              icon: Icon(audio.muted ? Icons.mic_off : Icons.mic, color: audio.muted ? theme.error : theme.primary),
              onPressed: () { audio.toggleMuteSelf(); setState(() {}); },
            ),
            IconButton(
              icon: const Icon(Icons.call_end, color: Colors.red),
              iconSize: 32,
              onPressed: _leaveRoom,
            ),
          ])),
        ),
      ]),
    );
  }
}

// =============================================================================
// voice_room_audio.dart
// =============================================================================

/// 通话音频管理：录音/编码/上传/播放/解码
/// 由 _VoiceRoomScreenState 持有，状态字段在调用方
class VoiceRoomAudio {
  AudioRecorder? recorder;
  AudioPlayer? player;
  AudioPlayer? _vmPlayer;
  LmdnProcessor? processor;
  StreamSubscription? recordSub;
  Timer? audioTimer;
  List<int> vmBuffer = [];
  bool vmRecording = false;
  final List<Uint8List> playQueue = [];
  final List<Uint8List> localQueue = [];
  final List<Uint8List> callFrames = [];
  List notes = [];
  bool playing = false;
  bool muted = false;
  bool localMode = false;
  int audioSeq = 0;
  LmdnConfig audioCfg = const LmdnConfig();

  QiniuDirectClient? client;
  String? targetPeerId;
  String state = 'calling';
  bool Function() isMounted = () => false;
  void Function(void Function()) setStateCb = (_) {};

  int _lastCpTs = 0;

  /// Write checkpoint to S3 (throttled: max 1 write/sec).
  void _writeCp(String label, String detail) {
    log('[$label] $detail');
    final now = DateTime.now().millisecondsSinceEpoch;
    if (now - _lastCpTs < 1000) return;
    _lastCpTs = now;
    final c = client;
    if (c != null) {
      c.writeFile('oc/debug/${c.peerId}/checkpoint.json', {
        'label': label, 'detail': detail, 'ts': now,
      });
    }
  }

  Future<void> startAudio() async {
    if (audioTimer != null) return;
    try {
      final cfg = await LmdnConfig.load();
      audioCfg = cfg;
      recorder = AudioRecorder();
      player = AudioPlayer();
      processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: cfg.denoise, enableCodec: !localMode);
      await processor?.initialize();
      _writeCp('C2', 'processor init ok');

      if (await recorder!.hasPermission() != true) {
        await recorder!.hasPermission(request: true);
        if (await recorder!.hasPermission() != true) {
          _writeCp('C2', 'mic denied');
          return;
        }
      }
      _writeCp('C2', 'mic perm ok');

      final stream = await recorder!.startStream(RecordConfig(
          encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: cfg.sampleRate));
      if (stream == null) {
        _writeCp('C3', 'stream null');
        return;
      }
      _writeCp('C3', 'record stream started');

      final bufSize = cfg.bufferBytes;
      final fadeBytes = cfg.fadeBytes;
      List<int> buffer = [];
      Uint8List? prevOverlap;
      final targetId = targetPeerId;
      if (targetId == null) return;

      recordSub = stream.listen((chunk) async {
        try {
          if (muted || state != 'connected') {
            buffer.clear();
            return;
          }
          buffer.addAll(chunk);
          if (buffer.length >= bufSize) {
            var frame = Uint8List.fromList(buffer.take(bufSize).toList());
            buffer = buffer.skip(bufSize).toList();
            final overlap = prevOverlap;
            if (overlap != null) {
              for (int i = 0; i < fadeBytes && i < frame.length; i += 2) {
                final ratio = i / fadeBytes;
                final pv = overlap[overlap.length - fadeBytes + i] | (overlap[overlap.length - fadeBytes + i + 1] << 8);
                final cv = frame[i] | (frame[i + 1] << 8);
                final ps = pv > 32767 ? pv - 65536 : pv;
                final cs = cv > 32767 ? cv - 65536 : cv;
                final blended = (ps * (1 - ratio) + cs * ratio).round().clamp(-32768, 32767);
                final bv = blended < 0 ? blended + 65536 : blended;
                frame[i] = bv & 0xFF;
                frame[i + 1] = (bv >> 8) & 0xFF;
              }
            }
            prevOverlap = Uint8List.fromList(frame.sublist(frame.length - fadeBytes));
            final processed = await processor?.processMicrophoneInput(frame);
            if (processed != null) {
              if (localMode) {
                localQueue.add(processed);
                _writeCp('C4', 'local enc size=${processed.length} q=${localQueue.length}');
              } else {
                final seq = audioSeq++;
                await client?.sendEncodedAudio(targetId, processed, seq);
                _writeCp('C4', 'sent seq=$seq size=${processed.length}');
              }
              callFrames.add(processed);
            } else {
              _writeCp('C4', 'encode null');
            }
          }
        } catch (e) {
          log('record process error: $e');
        }
      }, onError: (e) {
        log('record stream error: $e');
      });

      audioTimer?.cancel();
      audioTimer = Timer.periodic(Duration(milliseconds: cfg.pollMs), (_) async {
        if (state != 'connected' || client == null) return;
        try {
          final List<Uint8List> chunks;
          if (localMode) {
            chunks = List.from(localQueue);
            localQueue.clear();
            if (chunks.isNotEmpty) _writeCp('C5', 'local ${chunks.length} chunks');
          } else {
            chunks = await client!.pollEncodedAudio();
            if (chunks.isNotEmpty) _writeCp('C5', 'polled ${chunks.length} chunks');
          }
          if (chunks.isEmpty) return;
          for (final c in chunks) {
            final result = await processor?.processReceivedAudio(c);
            if (result != null) {
              playQueue.add(result.pcm);
              _writeCp('C6', 'decoded ${result.pcm.length} B');
              if (result.notes.isNotEmpty && isMounted()) {
                notes.addAll(result.notes);
                _writeCp('C8', 'notes=${result.notes.length}');
              }
            } else {
              _writeCp('C6', 'decode null');
            }
          }
          if (!playing) playNext();
        } catch (e) {
          log('audio poll error: $e');
        }
      });
    } catch (e) {
      log('_startAudio init error: $e');
    }
  }

  Future<void> startVmRecord() async {
    if (vmRecording) return;
    vmBuffer.clear();
    try {
      if (recorder == null) recorder = AudioRecorder();
      if (processor == null) {
        final cfg = await LmdnConfig.load();
        processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: false, enableCodec: true);
        await processor!.initialize();
      }
      if (_vmPlayer == null) _vmPlayer = AudioPlayer();
      if (await recorder!.hasPermission() != true) {
        await recorder!.hasPermission(request: true);
        if (await recorder!.hasPermission() != true) return;
      }
      final stream = await recorder!.startStream(RecordConfig(
          encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: processor!.sampleRate));
      if (stream == null) return;
      vmRecording = true;
      recordSub = stream.listen((chunk) {
        vmBuffer.addAll(chunk);
      }, onError: (e) {
        log('vm record error: $e');
        vmRecording = false;
      });
    } catch (e) {
      log('_startVmRecord error: $e');
      vmRecording = false;
    }
  }

  Future<void> endVmRecord() async {
    if (!vmRecording) return;
    vmRecording = false;
    await recordSub?.cancel();
    recordSub = null;
    await recorder?.stop();
    if (vmBuffer.isEmpty) return;
    final pcm = Uint8List.fromList(vmBuffer);
    vmBuffer.clear();
    try {
      processor?.resetCodec();
      final encoded = await processor?.processMicrophoneInput(pcm);
      if (encoded == null) {
        log('vm encode failed');
        return;
      }
      log('vm encoded ${pcm.length} B -> ${encoded.length} B');
      final result = await processor?.processReceivedAudio(encoded);
      if (result == null) {
        log('vm decode failed');
        return;
      }
      final wav = QiniuDirectClient.wavFromPcm(result.pcm, sampleRate: processor!.sampleRate);
      await _vmPlayer?.stop();
      await _vmPlayer?.play(BytesSource(wav));
    } catch (e) {
      log('_endVmRecord error: $e');
    }
  }

  Future<void> playNext() async {
    if (playQueue.isEmpty || !isMounted()) {
      playing = false;
      return;
    }
    playing = true;
    try {
      final targetBytes = 3 * audioCfg.sampleRate * 2;
      int total = 0;
      final batch = <Uint8List>[];
      while (playQueue.isNotEmpty && total < targetBytes) {
        final chunk = playQueue.removeAt(0);
        batch.add(chunk);
        total += chunk.length;
      }
      final pcm = Uint8List(total);
      int offset = 0;
      for (final chunk in batch) {
        pcm.setRange(offset, offset + chunk.length, chunk);
        offset += chunk.length;
      }
      final fadeSamples = audioCfg.fadeSamples;
      for (int i = 0; i < fadeSamples && i * 2 < pcm.length; i++) {
        final ratio = i / fadeSamples;
        final idx = i * 2;
        final v = pcm[idx] | (pcm[idx + 1] << 8);
        final s = ((v > 32767 ? v - 65536 : v) * ratio).round().clamp(-32768, 32767);
        final b = s < 0 ? s + 65536 : s;
        pcm[idx] = b & 0xFF;
        pcm[idx + 1] = (b >> 8) & 0xFF;
      }
      for (int i = 0; i < fadeSamples && pcm.length >= (i + 1) * 2; i++) {
        final ratio = i / fadeSamples;
        final idx = pcm.length - (i + 1) * 2;
        final v = pcm[idx] | (pcm[idx + 1] << 8);
        final s = ((v > 32767 ? v - 65536 : v) * (1 - ratio)).round().clamp(-32768, 32767);
        final b = s < 0 ? s + 65536 : s;
        pcm[idx] = b & 0xFF;
        pcm[idx + 1] = (b >> 8) & 0xFF;
      }
      final wav = QiniuDirectClient.wavFromPcm(pcm, sampleRate: audioCfg.sampleRate);
      log('[C7] play ${pcm.length} B');
      final p = player;
      if (p != null) {
        p.onPlayerComplete.first.then((_) => playNext());
        await p.play(BytesSource(wav));
      }
    } catch (e) {
      log('[C7] error: $e');
      playing = false;
    }
  }

// === invariants ===
// - recordSub 在 dispose() 中 cancel，不可漏
// - audioTimer 在 dispose() 中 cancel
// - playQueue/localQueue/callFrames dispose() 时清空
// - _writeCp 有节流（1s 内不重复写 S3），不影响音频路径
// - playNext 按 batch (3s) 消费 playQueue，不可重入（playing guard）
// - 所有 catch 均已记录日志，不再静默吞错误
// - callFrames append-only，_saveEpc 后由调用方清空

  void dispose() {
    recordSub?.cancel();
    recorder?.dispose();
    player?.dispose();
    _vmPlayer?.dispose();
    processor?.dispose();
    audioTimer?.cancel();
    vmBuffer.clear();
    playQueue.clear();
    localQueue.clear();
    callFrames.clear();
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
  final VoiceRoomAudio _audio = VoiceRoomAudio();
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

    _audio.client = _client;
    _audio.targetPeerId = _targetPeerId;
    _audio.isMounted = () => mounted;
    _audio.setStateCb = (cb) { if (mounted) setState(cb); };
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
    _audio.dispose();
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
          await _audio.startAudio();
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
    _audio.startAudio();
  }

  void _endCall() {
    if (_ended) return;
    _ended = true;
    _audio.localQueue.clear();
    _saveEpc();
    if (_targetPeerId != null) _client?.sendSignal(_targetPeerId!, 'call-end');
    if (mounted) setState(() => _state = 'ended');
    _signalTimer?.cancel();
    _audio.audioTimer?.cancel();
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
          _audio.startAudio();
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
// - _audio.dispose() 在 dispose() 中调用，释放录音/播放/定时器
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
