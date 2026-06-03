import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' hide log;
import 'dart:typed_data';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/audio.dart';

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
