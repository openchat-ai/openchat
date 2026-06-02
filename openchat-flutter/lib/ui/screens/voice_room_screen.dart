import 'dart:async';
import 'dart:convert';
import 'dart:developer' show log;
import 'dart:math' hide log;
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/lmdn_codec.dart';
import '../../core/ui_voice_config.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';
import '../components/resident/resident_music_score.dart';

class VoiceRoomScreen extends ConsumerStatefulWidget {
  const VoiceRoomScreen({super.key});

  @override
  ConsumerState<VoiceRoomScreen> createState() => _VoiceRoomScreenState();
}

class _VoiceRoomScreenState extends ConsumerState<VoiceRoomScreen> with SduiPageState {
  QiniuDirectClient? _client;
  String? _targetPeerId;
  String _state = 'calling';
  Timer? _signalTimer;
  Timer? _audioTimer;
  int _audioSeq = 0;
  bool _muted = false;
  bool _isSelfTest = false;
  AudioRecorder? _recorder;
  AudioPlayer? _player;
  StreamSubscription? _recordSub;
  LmdnProcessor? _processor;
  final List<Uint8List> _playQueue = [];
  bool _playing = false;
  VoiceUiConfig _uiVoice = const VoiceUiConfig();
  LmdnConfig _audioCfg = const LmdnConfig();
  Map<String, void Function()> _customActions = {};
  final List<Uint8List> _callFrames = [];
  final List<ScoreNote> _allNotes = [];
  final List<Uint8List> _localQueue = [];
  bool _localMode = true;
  bool _vmMode = false;
  bool _vmRecording = false;
  final List<int> _vmBuffer = [];

  @override
  String get sduiPage => 'voice';

  @override
  void initState() {
    super.initState();
    final args = ModalRoute.of(context)?.settings.arguments;
    final argMap = args is Map ? Map<String, dynamic>.from(args) : {};
    _targetPeerId = argMap['targetPeerId'] as String?;
    _client = argMap['client'] as QiniuDirectClient?;

    VoiceUiConfig.load().then((c) { if (mounted) setState(() => _uiVoice = c); });

    if (_targetPeerId != null && _client != null) {
      _signalTimer = Timer.periodic(const Duration(seconds: 2), (_) => _pollResponse());
    }

    if (argMap['selfTest'] == 'true') {
      _isSelfTest = true;
      _initSelfTest();
    }
  }

  Future<void> _initSelfTest() async {
    if (_client == null) {
      final prefs = await SharedPreferences.getInstance();
      final pid = prefs.getString('peerId') ?? '${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999).toString().padLeft(5, '0')}';
      _client = QiniuDirectClient(peerId: pid);
    }
    if (_client == null) return;
    _signalTimer?.cancel();
    await _client!.register();
    log('[C1] registered peer=${_client!.peerId}');
    _targetPeerId = _client!.peerId;
    if (mounted) {
      setState(() => _state = 'calling');
    }
  }
    if (_client == null) return;
    _signalTimer?.cancel(); // no need to poll for peer signals in loopback
    await _client!.register();
    _targetPeerId = _client!.peerId; // loopback: send and receive from our own audio dir
    final cfg = await LmdnConfig.load();
    if (mounted) {
      setState(() => _state = 'calling');
      // Don't auto-connect; user picks mode via UI buttons
    }
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
          _startAudio();
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

  bool _audioStarted = false;

  void _acceptCall() {
    if (_targetPeerId == null) return;
    _client?.sendSignal(_targetPeerId!, 'call-accept');
    if (mounted) setState(() => _state = 'connected');
    _startAudio();
  }

  bool _ended = false;

  void _endCall() {
    if (_ended) return; // guard against double invocation (timer + button)
    _ended = true;
    _audioStarted = false;
    _recordSub?.cancel();
    _recorder?.dispose();
    _player?.dispose();
    _processor?.dispose();
    if (_targetPeerId != null) _client?.sendSignal(_targetPeerId!, 'call-end');
    _localQueue.clear();
    _saveEpc();
    if (mounted) setState(() => _state = 'ended');
    _signalTimer?.cancel();
    _audioTimer?.cancel();
    if (mounted && Navigator.canPop(context)) Navigator.pop(context);
  }

  Future<void> _saveEpc() async {
    if (_callFrames.isEmpty) return;
    try {
      int total = _callFrames.fold(0, (s, f) => s + f.length);
      final epc = Uint8List(total);
      int off = 0;
      for (final f in _callFrames) {
        epc.setRange(off, off + f.length, f);
        off += f.length;
      }
      _callFrames.clear();
      await _client?.saveEpcRecord(epc);
    } catch (e) {
      log('saveEpc error: $e');
    }
  }

  Future<void> _startAudio() async {
    if (_audioStarted) return;
    _audioStarted = true;
    try {
      final cfg = await LmdnConfig.load();
      _audioCfg = cfg;
      _recorder = AudioRecorder();
      _player = AudioPlayer();
      _processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: cfg.denoise, enableCodec: true);
      await _processor?.initialize();
      log('[C2] processor init ok');

      if (await _recorder!.hasPermission() != true) {
        await _recorder!.requestPermission();
        if (await _recorder!.hasPermission() != true) { _audioStarted = false; log('[C2] mic denied'); return; }
      }
      log('[C2] mic perm ok');

      final stream = await _recorder!.startStream(RecordConfig(
        encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: cfg.sampleRate));
      if (stream == null) { _audioStarted = false; log('[C3] stream null'); return; }
      log('[C3] record stream started');

      final bufSize = cfg.bufferBytes;
      final fadeBytes = cfg.fadeBytes;
      List<int> _buffer = [];
      Uint8List? _prevOverlap;
      final targetId = _targetPeerId;
      if (targetId == null) return;
      _recordSub = stream.listen((chunk) async {
        try {
          if (_muted || _state != 'connected') { _buffer.clear(); return; }
          _buffer.addAll(chunk);
          if (_buffer.length >= bufSize) {
            var frame = Uint8List.fromList(_buffer.take(bufSize).toList());
            _buffer = _buffer.skip(bufSize).toList();
            final overlap = _prevOverlap;
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
            _prevOverlap = Uint8List.fromList(frame.sublist(frame.length - fadeBytes));
            final processed = await _processor?.processMicrophoneInput(frame);
            if (processed != null) {
              if (_localMode) {
                _localQueue.add(processed);
              } else {
                await _client?.sendEncodedAudio(targetId, processed, _audioSeq++);
                log('[C4] sent seq=$_audioSeq size=${processed.length}');
              }
              _callFrames.add(processed);
            }
          }
        } catch (e) { log('record process error: $e'); }
      }, onError: (e) { log('record stream error: $e'); });

      // Use a dedicated audio timer so the signaling timer keeps running
      // and can still detect remote call-end after we are connected.
      _audioTimer?.cancel();
      _audioTimer = Timer.periodic(Duration(milliseconds: cfg.pollMs), (_) async {
        if (_state != 'connected' || _client == null) return;
        try {
          final List<Uint8List> chunks;
          if (_localMode) {
            chunks = _localQueue;
            _localQueue = [];
          } else {
            chunks = await _client!.pollEncodedAudio();
            if (chunks.isNotEmpty) log('[C5] polled ${chunks.length} chunks');
          }
          if (chunks.isEmpty) return;
            for (final c in chunks) {
              final result = await _processor?.processReceivedAudio(c);
              if (result != null) {
                _playQueue.add(result.pcm);
                log('[C6] decoded ${result.pcm.length} B');
                if (result.notes.isNotEmpty && mounted) {
                  setState(() => _allNotes.addAll(result.notes));
                  log('[C8] notes=${result.notes.length}');
                }
              }
            }
          if (!_playing) _playNext();
        } catch (e) {
          log('audio poll error: $e');
        }
      });
    } catch (e) {
      log('_startAudio init error: $e');
      _audioStarted = false;
    }
  }

  Future<void> _startVmRecord() async {
    if (_vmRecording) return;
    _vmBuffer.clear();
    try {
      if (_recorder == null) _recorder = AudioRecorder();
      if (_processor == null) {
        final cfg = await LmdnConfig.load();
        _processor = LmdnProcessor(sampleRate: cfg.sampleRate, enableDenoise: false, enableCodec: true);
        await _processor!.initialize();
      }
      if (_player == null) _player = AudioPlayer();
      if (await _recorder!.hasPermission() != true) {
        await _recorder!.requestPermission();
        if (await _recorder!.hasPermission() != true) return;
      }
      final stream = await _recorder!.startStream(RecordConfig(
        encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: _processor!.sampleRate));
      if (stream == null) return;
      _vmRecording = true;
      if (mounted) setState(() {});
      _recordSub = stream.listen((chunk) {
        _vmBuffer.addAll(chunk);
      }, onError: (e) {
        log('vm record error: $e');
        _vmRecording = false;
      });
    } catch (e) {
      log('_startVmRecord error: $e');
      _vmRecording = false;
    }
  }

  Future<void> _endVmRecord() async {
    if (!_vmRecording) return;
    _vmRecording = false;
    await _recordSub?.cancel();
    _recordSub = null;
    await _recorder?.stop();
    if (_vmBuffer.isEmpty) return;
    final pcm = Uint8List.fromList(_vmBuffer);
    _vmBuffer.clear();
    try {
      final encoded = await _processor?.processMicrophoneInput(pcm);
      if (encoded == null) { log('vm encode failed'); return; }
      log('vm encoded ${pcm.length} B -> ${encoded.length} B');
      final result = await _processor?.processReceivedAudio(encoded);
      if (result == null) { log('vm decode failed'); return; }
      if (mounted) {
        final wav = QiniuDirectClient.wavFromPcm(result.pcm);
        await _player?.stop();
        await _player?.play(BytesSource(wav));
      }
    } catch (e) {
      log('_endVmRecord error: $e');
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

      final fadeSamples = _audioCfg.fadeSamples;
      for (int i = 0; i < fadeSamples && i * 2 < pcm.length; i++) {
        final ratio = i / fadeSamples;
        final idx = i * 2;
        final v = pcm[idx] | (pcm[idx + 1] << 8);
        final s = ((v > 32767 ? v - 65536 : v) * ratio).round().clamp(-32768, 32767);
        final b = s < 0 ? s + 65536 : s;
        pcm[idx] = b & 0xFF; pcm[idx + 1] = (b >> 8) & 0xFF;
      }
      for (int i = 0; i < fadeSamples && pcm.length >= (i + 1) * 2; i++) {
        final ratio = i / fadeSamples;
        final idx = pcm.length - (i + 1) * 2;
        final v = pcm[idx] | (pcm[idx + 1] << 8);
        final s = ((v > 32767 ? v - 65536 : v) * (1 - ratio)).round().clamp(-32768, 32767);
        final b = s < 0 ? s + 65536 : s;
        pcm[idx] = b & 0xFF; pcm[idx + 1] = (b >> 8) & 0xFF;
      }

      final wav = QiniuDirectClient.wavFromPcm(pcm);
      log('[C7] play ${pcm.length} B');
      final player = _player;
      if (player != null) {
        player.onPlayerComplete.first.then((_) => _playNext());
        await player.play(BytesSource(wav));
      }
    } catch (e) {
      log('[C7] error: $e');
      _playing = false;
    }
  }

  Future<void> _saveEpc() async {
    if (_callFrames.isEmpty) { log('[C9] no frames to save'); return; }
    try {
      int total = _callFrames.fold(0, (s, f) => s + f.length);
      final epc = Uint8List(total);
      int off = 0;
      for (final f in _callFrames) {
        epc.setRange(off, off + f.length, f);
        off += f.length;
      }
      _callFrames.clear();
      await _client?.saveEpcRecord(epc);
      log('[C9] saved epc ${epc.length} B');
    } catch (e) {
      log('[C9] error: $e');
    }
  }

      final pcm = Uint8List(total);
      int offset = 0;
      for (final chunk in batch) {
        pcm.setRange(offset, offset + chunk.length, chunk);
        offset += chunk.length;
      }

      // Single fade-in at start, fade-out at end (only at batch boundaries)
      final fadeSamples = _audioCfg.fadeSamples;
      for (int i = 0; i < fadeSamples && i * 2 < pcm.length; i++) {
        final ratio = i / fadeSamples;
        final idx = i * 2;
        final v = pcm[idx] | (pcm[idx + 1] << 8);
        final s = ((v > 32767 ? v - 65536 : v) * ratio).round().clamp(-32768, 32767);
        final b = s < 0 ? s + 65536 : s;
        pcm[idx] = b & 0xFF; pcm[idx + 1] = (b >> 8) & 0xFF;
      }
      for (int i = 0; i < fadeSamples && pcm.length >= (i + 1) * 2; i++) {
        final ratio = i / fadeSamples;
        final idx = pcm.length - (i + 1) * 2;
        final v = pcm[idx] | (pcm[idx + 1] << 8);
        final s = ((v > 32767 ? v - 65536 : v) * (1 - ratio)).round().clamp(-32768, 32767);
        final b = s < 0 ? s + 65536 : s;
        pcm[idx] = b & 0xFF; pcm[idx + 1] = (b >> 8) & 0xFF;
      }

      final wav = QiniuDirectClient.wavFromPcm(pcm);
      final player = _player;
      if (player != null) {
        player.onPlayerComplete.first.then((_) => _playNext());
        await player.play(BytesSource(wav));
      }
    } catch (e) {
      log('_playNext error: $e');
      _playing = false;
    }
  }

  void _handleAction(String action) {
    if (_customActions.containsKey(action)) {
      _customActions[action]!();
      return;
    }
    switch (action) {
      case 'hangup': _endCall();
      case 'toggle_mute': if (mounted) setState(() => _muted = !_muted);
      case 'accept_call': _acceptCall();
    }
  }

  @override
  void dispose() {
    _recordSub?.cancel();
    _recorder?.dispose();
    _player?.dispose();
    _processor?.dispose();
    _signalTimer?.cancel();
    _audioTimer?.cancel();
    // Only dispose the client we created ourselves (self-test). When passed in
    // from PeopleScreen it is shared and owned by that screen.
    if (_isSelfTest) _client?.dispose();
    super.dispose();
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

    // Self-test mode selection (before SDUI, gated by _isSelfTest)
    if (_isSelfTest && _state == 'calling' && !_vmMode) {
      return Scaffold(
        backgroundColor: theme.background,
        body: SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              Icon(Icons.mic_rounded, size: 64, color: Colors.white),
              const SizedBox(height: 24),
              Text('选择模式', style: TextStyle(color: theme.textPrimary, fontSize: 22, fontWeight: FontWeight.w600)),
              const SizedBox(height: 48),
              _ctrlBtn(Icons.headset, theme.primary, () {
                setState(() => _state = 'connected');
                _startAudio();
              }, label: '实时通话'),
              const SizedBox(height: 24),
              _ctrlBtn(Icons.send_rounded, theme.textPrimary, () {
                setState(() { _vmMode = true; _state = 'voiceMessage'; });
              }, label: '语音消息'),
              const Spacer(),
            ],
          ),
        ),
      );
    }

    // Voice message UI
    if (_state == 'voiceMessage' && _vmMode) {
      return Scaffold(
        backgroundColor: theme.background,
        body: SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(),
              Icon(_vmRecording ? Icons.mic : Icons.mic_none, size: 64,
                   color: _vmRecording ? theme.error : theme.textPrimary),
              const SizedBox(height: 24),
              Text(_vmRecording ? '录音中...' : '按住说话',
                   style: TextStyle(color: theme.textPrimary, fontSize: 20)),
              const SizedBox(height: 48),
              Listener(
                onPointerDown: (_) => _startVmRecord(),
                onPointerUp: (_) => _endVmRecord(),
                onPointerCancel: (_) => _endVmRecord(),
                child: Container(
                  width: 120, height: 120,
                  decoration: BoxDecoration(
                    color: _vmRecording ? theme.error.withValues(alpha: 0.3) : theme.primary.withValues(alpha: 0.2),
                    borderRadius: BorderRadius.circular(60),
                    border: Border.all(color: _vmRecording ? theme.error : theme.primary, width: 2),
                  ),
                  child: Icon(Icons.mic, size: 48, color: _vmRecording ? theme.error : theme.textPrimary),
                ),
              ),
              const SizedBox(height: 48),
              TextButton(
                onPressed: () { if (mounted) setState(() { _vmMode = false; _state = 'calling'; }); },
                child: Text('返回', style: TextStyle(color: theme.textTertiary)),
              ),
              const Spacer(),
            ],
          ),
        ),
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

    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Spacer(),
            Icon(Icons.mic_rounded, size: 48, color: Colors.white),
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
              _ctrlBtn(Icons.call_end, theme.error, _endCall, big: true),
            if (_state == 'connected')
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                _ctrlBtn(_muted ? Icons.mic_off : Icons.mic, theme.primary, () => setState(() => _muted = !_muted)),
                const SizedBox(width: 16),
                _ctrlBtn(_localMode ? Icons.storage : Icons.cloud_upload, _localMode ? theme.textPrimary : theme.primary, () { setState(() {
                  _localMode = !_localMode;
                  if (!_localMode) _localQueue.clear();
                }); }),
                const SizedBox(width: 16),
                _ctrlBtn(Icons.call_end, theme.error, _endCall, big: true),
              ]),
            const Spacer(),
          ],
        ),
      ),
    );
  }

  Widget _ctrlBtn(IconData icon, Color color, VoidCallback onTap, {bool big = false, String? label}) {
    if (label != null) {
      return GestureDetector(
        onTap: onTap,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: big ? 72 : 56, height: big ? 72 : 56,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.2),
              borderRadius: BorderRadius.circular(big ? 24 : 18),
              border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
            ),
            child: Icon(icon, color: Colors.white, size: big ? 32 : 24),
          ),
          const SizedBox(height: 8),
          Text(label, style: TextStyle(color: Colors.white.withValues(alpha: 0.7), fontSize: 12)),
        ]),
      );
    }
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: big ? 72 : 56, height: big ? 72 : 56,
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
