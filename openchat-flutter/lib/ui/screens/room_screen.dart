import 'dart:async';
import 'dart:developer' show log;
import 'dart:math';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/lmdn_codec.dart';
import '../../core/ui_voice_config.dart';

class RoomScreen extends ConsumerStatefulWidget {
  final String roomId;
  const RoomScreen({super.key, required this.roomId});

  @override
  ConsumerState<RoomScreen> createState() => _RoomScreenState();
}

class _RoomScreenState extends ConsumerState<RoomScreen> {
  QiniuDirectClient? _client;
  AudioRecorder? _recorder;
  AudioPlayer? _player;
  StreamSubscription? _recordSub;
  LmdnProcessor? _processor;
  Timer? _audioTimer;
  int _audioSeq = 0;
  bool _muted = false;
  bool _audioStarted = false;
  bool _ended = false;
  final List<Uint8List> _playQueue = [];
  bool _playing = false;
  String _myPeerId = '';
  final Map<String, int> _playedSeqs = {}; // peerId -> max played seq
  final Map<String, bool> _mutedPeers = {}; // peerId -> isMuted
  final Set<String> _participants = {}; // discovered peer IDs

  @override
  void initState() {
    super.initState();
    _initRoom();
  }

  Future<void> _initRoom() async {
    log('[C15] room init enter');
    final prefs = await SharedPreferences.getInstance();
    final pid = prefs.getString('peerId') ?? 'room_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
    _client = QiniuDirectClient(peerId: pid);
    await _client!.register();
    _myPeerId = _client!.peerId;
    log('[C15] room init ok peer=$_myPeerId');
    if (mounted) setState(() {});
    _startAudio();
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
        await _recorder!.requestPermission();
        if (await _recorder!.hasPermission() != true) { _audioStarted = false; log('[C15] mic perm denied'); return; }
      }
      log('[C15] mic perm ok');

      final stream = await _recorder!.startStream(RecordConfig(
        encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: cfg.sampleRate));
      if (stream == null) { _audioStarted = false; log('[C15] stream null'); return; }
      log('[C15] stream started');

      final bufSize = cfg.bufferBytes;
      List<int> _buffer = [];
      int bytesEncoded = 0, framesEncoded = 0;
      _recordSub = stream.listen((chunk) async {
        try {
          if (_muted || _ended) { _buffer.clear(); return; }
          _buffer.addAll(chunk);
          if (_buffer.length >= bufSize) {
            var frame = Uint8List.fromList(_buffer.take(bufSize).toList());
            _buffer = _buffer.skip(bufSize).toList();
            final processed = await _processor?.processMicrophoneInput(frame);
            if (processed != null) {
              final key = 'oc/rooms/${widget.roomId}/$_myPeerId/${_audioSeq++}.enc';
              await _client?.putBinary(key, processed);
              bytesEncoded += processed.length;
              framesEncoded++;
            }
          }
        } catch (e) { log('[C16] record error: $e'); }
      }, onError: (e) { log('[C16] stream error: $e'); });

      log('[C15] upload path oc/rooms/${widget.roomId}/$_myPeerId/');
      _audioTimer = Timer.periodic(Duration(milliseconds: cfg.pollMs), (_) => _pollRoom());
    } catch (e) {
      log('[C15] init error: $e');
      _audioStarted = false;
    }
  }

  Future<void> _pollRoom() async {
    if (_ended || _client == null) return;
    try {
      final prefix = 'oc/rooms/${widget.roomId}/';
      final allKeys = await _client!.listFiles(prefix);
      log('[C16] listFiles prefix=$prefix count=${allKeys.length}');
      final peerDirs = <String>{};
      for (final k in allKeys) {
        final parts = k.split('/');
        if (parts.length >= 4) peerDirs.add(parts[3]);
      }
      if (mounted && peerDirs.length != _participants.length) {
        setState(() => _participants.addAll(peerDirs));
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
    if (_playQueue.isEmpty || !mounted) { _playing = false; return; }
    _playing = true;
    try {
      const targetBytes = 3 * 24000 * 2;
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
      final wav = QiniuDirectClient.wavFromPcm(pcm);
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

  void _leaveRoom() {
    if (_ended) return;
    _ended = true;
    _recordSub?.cancel();
    _recorder?.dispose();
    _player?.dispose();
    _processor?.dispose();
    _audioTimer?.cancel();
    _client?.dispose();
    if (mounted && Navigator.canPop(context)) Navigator.pop(context);
  }

  @override
  void dispose() {
    _leaveRoom();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    final sortedPeers = _participants.where((p) => p != _myPeerId).toList()..sort();

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surface.withValues(alpha: 0.5),
        elevation: 0,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('房间: ${widget.roomId}', style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
          Text('${_participants.length} 人在线', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
        ]),
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: theme.textPrimary),
          onPressed: _leaveRoom,
        ),
      ),
      body: Column(children: [
        Expanded(child: _participants.isEmpty
          ? Center(child: Text('等待其他人加入...', style: TextStyle(color: theme.textTertiary, fontSize: 16)))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: sortedPeers.length + 1, // +1 for self
              itemBuilder: (context, index) {
                final isSelf = index == 0;
                final peerId = isSelf ? _myPeerId : sortedPeers[index - 1];
                final isMuted = isSelf ? _muted : (_mutedPeers[peerId] ?? false);
                return Card(
                  color: theme.surface.withValues(alpha: 0.4),
                  margin: const EdgeInsets.symmetric(vertical: 4),
                  child: ListTile(
                    leading: CircleAvatar(child: Icon(Icons.person, color: Colors.white)),
                    title: Text(isSelf ? '我 ($peerId)' : peerId,
                      style: TextStyle(color: theme.textPrimary, fontSize: 14)),
                    trailing: IconButton(
                      icon: Icon(isMuted ? Icons.mic_off : Icons.mic, color: isMuted ? theme.error : theme.textSecondary),
                      onPressed: isSelf
                        ? () => setState(() => _muted = !_muted)
                        : () => setState(() {
                            _mutedPeers[peerId] = !(_mutedPeers[peerId] ?? false);
                          }),
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
              icon: Icon(_muted ? Icons.mic_off : Icons.mic, color: _muted ? theme.error : theme.primary),
              onPressed: () => setState(() => _muted = !_muted),
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
