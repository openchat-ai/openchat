// audio_engine.dart — unified audio engine for voice rooms
//
// Replaces RoomAudio + VoiceRoomAudio with a single class with feature flags.
// Chat voice (single-shot file) is intentionally NOT merged here — different
// pattern (one-shot record/upload/play) vs streaming real-time.
//
// === invariants ===
// - _ended 守卫: leave() 后所有 poll/record/play 操作立即返回
// - _recordSub/audioTimer 在 dispose() 中 cancel, 不可漏
// - _playQueue 重入保护: _playing 标志位
// - start() 调用后 _myPeerId 才设置, 调用方可读
// - vmRecordEnabled=false 时, startVmRecord/endVmRecord 抛 UnimplementedError
// - peerMuteEnabled=false 时, toggleMutePeer/isPeerMuted 始终返回 false/不操作
// - enableNotes=true 时, decode 命中 result.notes 自动追加

import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' hide log;
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:record/record.dart';

import '../../core/api/qiniu_direct_client.dart';
import 'audio.dart';

typedef ParticipantsCallback = void Function(Set<String> participants);
typedef NotesCallback = void Function(List<ScoreNote> notes);

class AudioEngineConfig {
  final String roomId;
  final bool vmRecordEnabled;
  final bool localModeEnabled;
  final bool callFramesEnabled;
  final bool notesEnabled;
  final bool peerMuteEnabled;
  const AudioEngineConfig({
    required this.roomId,
    this.vmRecordEnabled = false,
    this.localModeEnabled = false,
    this.callFramesEnabled = false,
    this.notesEnabled = false,
    this.peerMuteEnabled = false,
  });
}

class AudioEngine {
  final AudioEngineConfig cfg;
  final ParticipantsCallback? onParticipants;
  final NotesCallback? onNotes;
  final void Function()? onState;
  final QiniuDirectClient? externalClient;

  QiniuDirectClient? _client;
  AudioRecorder? _recorder;
  AudioPlayer? _player;
  AudioPlayer? _vmPlayer;
  LmdnProcessor? _processor;
  StreamSubscription? _recordSub;
  Timer? _pollTimer;
  LmdnConfig _audioCfg = const LmdnConfig();

  String _myPeerId = '';
  int _seq = 0;
  bool _started = false;
  bool _ended = false;
  bool _muted = false;
  bool _playing = false;
  bool _vmRecording = false;
  bool _localMode = false;
  String _state = 'idle';
  String? _targetPeerId;

  final List<Uint8List> _playQueue = [];
  final List<int> _vmBuffer = [];
  final List<Uint8List> _localQueue = [];
  final List<Uint8List> _callFrames = [];
  final List<ScoreNote> _notes = [];
  final Set<String> _participants = {};
  final Map<String, int> _playedSeqs = {};
  final Map<String, bool> _mutedPeers = {};

  AudioEngine({
    required this.cfg,
    this.onParticipants,
    this.onNotes,
    this.onState,
    this.externalClient,
  });

  String get myPeerId => _myPeerId;
  Set<String> get participants => _participants;
  Map<String, bool> get mutedPeers => _mutedPeers;
  bool get muted => _muted;
  bool get ended => _ended;
  bool get vmRecording => _vmRecording;
  bool get localMode => _localMode;
  List<Uint8List> get callFrames => _callFrames;
  List<ScoreNote> get notes => List.unmodifiable(_notes);
  String get state => _state;
  String? get targetPeerId => _targetPeerId;
  set targetPeerId(String? v) => _targetPeerId = v;
  set localMode(bool v) {
    _localMode = v;
    if (!v) _localQueue.clear();
  }
  set muted(bool v) => _muted = v;
  set state(String v) => _state = v;
  set notes(List v) { if (cfg.notesEnabled) _notes.clear(); _notes.addAll(v.cast<ScoreNote>()); }
  QiniuDirectClient? get client => _client;
  set client(QiniuDirectClient? v) => _client = v;

  // === init ===

  Future<void> start() async {
    if (_started) return;
    _started = true;
    if (externalClient != null) {
      _client = externalClient;
    } else {
      final pid = '${cfg.roomId}_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
      _client = QiniuDirectClient(peerId: pid);
      await _client!.register();
    }
    _myPeerId = _client!.peerId;
    log('[audio] start ok peer=$_myPeerId');
    onState?.call();
    await _startAudio();
  }

  Future<void> _startAudio() async {
    if (_ended) return;
    try {
      _audioCfg = await LmdnConfig.load();
      _recorder = AudioRecorder();
      _player = AudioPlayer();
      _processor = LmdnProcessor(
        sampleRate: _audioCfg.sampleRate,
        enableDenoise: _audioCfg.denoise,
        enableCodec: !_localMode,
      );
      await _processor!.initialize();
      log('[audio] processor init ok');

      if (await _recorder!.hasPermission() != true) {
        await _recorder!.hasPermission(request: true);
        if (await _recorder!.hasPermission() != true) {
          log('[audio] mic perm denied');
          return;
        }
      }

      final stream = await _recorder!.startStream(RecordConfig(
        encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: _audioCfg.sampleRate,
      ));
      if (stream == null) { log('[audio] stream null'); return; }
      log('[audio] stream started');

      final bufSize = _audioCfg.bufferBytes;
      final targetId = _targetPeerId;
      final uploadToPeer = targetId != null && _client != null && _state == 'connected';

      final buffer = <int>[];
      _recordSub = stream.listen((chunk) async {
        try {
          if (_muted || _ended) return;
          buffer.addAll(chunk);
          while (buffer.length >= bufSize) {
            final frame = Uint8List.fromList(buffer.sublist(0, bufSize));
            buffer.removeRange(0, bufSize);
            final processed = await _processor?.processMicrophoneInput(frame);
            if (processed == null) continue;
            if (cfg.localModeEnabled && _localMode) {
              _localQueue.add(processed);
            } else if (uploadToPeer) {
              await _client!.sendEncodedAudio(targetId, processed, _seq++);
            } else {
              final key = 'oc/rooms/${cfg.roomId}/$_myPeerId/${_seq++}.enc';
              await _client?.putBinary(key, processed);
            }
            if (cfg.callFramesEnabled) _callFrames.add(processed);
          }
        } catch (e) {
          log('[audio] record error: $e');
        }
      }, onError: (e) => log('[audio] stream error: $e'));

      _pollTimer = Timer.periodic(Duration(milliseconds: _audioCfg.pollMs), (_) => _poll());
    } catch (e) {
      log('[audio] start error: $e');
    }
  }

  // === poll ===

  Future<void> _poll() async {
    if (_ended || _client == null) return;
    try {
      if (cfg.localModeEnabled && _localMode) {
        if (_localQueue.isEmpty) return;
        for (final c in List<Uint8List>.from(_localQueue)) {
          final result = await _processor?.processReceivedAudio(c);
          if (result != null) _playQueue.add(result.pcm);
        }
        _localQueue.clear();
        if (!_playing) _playNext();
        return;
      }
      if (cfg.vmRecordEnabled) {
        // VoiceRoomAudio: poll via client
        final chunks = await _client!.pollEncodedAudio();
        for (final c in chunks) {
          final result = await _processor?.processReceivedAudio(c);
          if (result != null) {
            _playQueue.add(result.pcm);
            if (cfg.notesEnabled && result.notes.isNotEmpty) {
              _notes.addAll(result.notes);
              onNotes?.call(_notes);
            }
          }
        }
        if (!_playing) _playNext();
        return;
      }
      // RoomAudio path: list oc/rooms/{roomId}/ and fetch by peer
      final prefix = 'oc/rooms/${cfg.roomId}/';
      final allKeys = await _client!.listFiles(prefix);
      final peerDirs = <String>{};
      for (final k in allKeys) {
        final parts = k.split('/');
        if (parts.length >= 4) peerDirs.add(parts[3]);
      }
      if (peerDirs.length != _participants.length) {
        _participants.addAll(peerDirs);
        onParticipants?.call(_participants);
      }
      for (final peerId in peerDirs) {
        if (peerId == _myPeerId) continue;
        if (cfg.peerMuteEnabled && _mutedPeers[peerId] == true) continue;
        final lastSeq = _playedSeqs[peerId] ?? -1;
        final peerPrefix = '$prefix$peerId/';
        for (final k in allKeys) {
          if (!k.startsWith(peerPrefix)) continue;
          final seqStr = k.split('/').last.replaceAll('.enc', '');
          final seq = int.tryParse(seqStr) ?? -1;
          if (seq <= lastSeq) continue;
          _playedSeqs[peerId] = seq;
          final data = await _client!.getBinary(k);
          if (data.isEmpty) continue;
          final result = await _processor?.processReceivedAudio(data);
          if (result != null) _playQueue.add(result.pcm);
        }
      }
      if (!_playing) _playNext();
    } catch (e) {
      log('[audio] poll error: $e');
    }
  }

  // === play ===

  Future<void> _playNext() async {
    if (_playQueue.isEmpty || _ended) { _playing = false; return; }
    _playing = true;
    try {
      final targetBytes = 3 * _audioCfg.sampleRate * 2;
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
      final sr = _processor?.sampleRate ?? _audioCfg.sampleRate;
      final wav = QiniuDirectClient.wavFromPcm(pcm, sampleRate: sr);
      final p = _player;
      if (p != null) {
        p.onPlayerComplete.first.then((_) => _playNext());
        await p.play(BytesSource(wav));
      }
    } catch (e) {
      log('[audio] play error: $e');
      _playing = false;
    }
  }

  // === mute ===

  void toggleMuteSelf() {
    if (_ended) return;
    _muted = !_muted;
  }

  void toggleMutePeer(String peerId) {
    if (!cfg.peerMuteEnabled) return;
    _mutedPeers[peerId] = !(_mutedPeers[peerId] ?? false);
  }

  bool isPeerMuted(String peerId) {
    if (!cfg.peerMuteEnabled) return false;
    return _mutedPeers[peerId] ?? false;
  }

  // === VM record (only when vmRecordEnabled) ===

  Future<void> startVmRecord() async {
    if (!cfg.vmRecordEnabled) throw UnimplementedError('vmRecord disabled');
    if (_vmRecording) return;
    _vmBuffer.clear();
    try {
      _vmRecording = true;
      if (_recorder == null) {
        _recorder = AudioRecorder();
        if (await _recorder!.hasPermission() != true) {
          await _recorder!.hasPermission(request: true);
          if (await _recorder!.hasPermission() != true) { _vmRecording = false; return; }
        }
        final stream = await _recorder!.startStream(RecordConfig(
          encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: _audioCfg.sampleRate,
        ));
        if (stream == null) { _vmRecording = false; return; }
        _recordSub = stream.listen((chunk) => _vmBuffer.addAll(chunk),
          onError: (e) { log('[audio] vm error: $e'); _vmRecording = false; });
      }
      if (_vmPlayer == null) _vmPlayer = AudioPlayer();
    } catch (e) {
      log('[audio] startVm error: $e');
      _vmRecording = false;
    }
  }

  Future<void> endVmRecord() async {
    if (!cfg.vmRecordEnabled) throw UnimplementedError('vmRecord disabled');
    if (!_vmRecording) return;
    _vmRecording = false;
    await _recordSub?.cancel();
    _recordSub = null;
    await _recorder?.stop();
    if (_vmBuffer.isEmpty) return;
    final pcm = Uint8List.fromList(_vmBuffer);
    _vmBuffer.clear();
    try {
      _processor?.resetCodec();
      final encoded = await _processor?.processMicrophoneInput(pcm);
      if (encoded == null) { log('[audio] vm encode fail'); return; }
      final result = await _processor?.processReceivedAudio(encoded);
      if (result == null) { log('[audio] vm decode fail'); return; }
      final wav = QiniuDirectClient.wavFromPcm(result.pcm, sampleRate: _processor!.sampleRate);
      await _vmPlayer?.stop();
      await _vmPlayer?.play(BytesSource(wav));
    } catch (e) {
      log('[audio] endVm error: $e');
    }
  }

  void clearLocalQueue() => _localQueue.clear();

  // === callFrames save (only when callFramesEnabled) ===

  Future<void> saveCallFrames({String? suffix}) async {
    if (!cfg.callFramesEnabled) return;
    if (_callFrames.isEmpty) return;
    final total = _callFrames.fold<int>(0, (s, f) => s + f.length);
    final epc = Uint8List(total);
    int off = 0;
    for (final f in _callFrames) {
      epc.setRange(off, off + f.length, f);
      off += f.length;
    }
    await _client?.saveEpcRecord(epc);
    _callFrames.clear();
  }

  // === cleanup ===

  Future<void> leave() async {
    if (_ended) return;
    _ended = true;
    _recordSub?.cancel();
    _recorder?.dispose();
    _player?.dispose();
    _vmPlayer?.dispose();
    _processor?.dispose();
    _pollTimer?.cancel();
    _client?.dispose();
    _vmBuffer.clear();
    _playQueue.clear();
    _localQueue.clear();
    _callFrames.clear();
  }
}
