import 'dart:async';
import 'dart:convert';
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
import '../../core/audio/audio_processor.dart';
import '../../core/audio/audio_config.dart';
import '../../core/ui_voice_config.dart';

class VoiceRoomScreen extends ConsumerStatefulWidget {
  const VoiceRoomScreen({super.key});

  @override
  ConsumerState<VoiceRoomScreen> createState() => _VoiceRoomScreenState();
}

class _VoiceRoomScreenState extends ConsumerState<VoiceRoomScreen> {
  QiniuDirectClient? _client;
  String? _targetPeerId;
  String _state = 'calling';
  Timer? _signalTimer;
  int _audioSeq = 0;
  bool _muted = false;
  AudioRecorder? _recorder;
  AudioPlayer? _player;
  StreamSubscription? _recordSub;
  AudioProcessor? _processor;
  final List<Uint8List> _playQueue = [];
  bool _playing = false;
  VoiceUiConfig _uiVoice = const VoiceUiConfig();
  AudioConfig _audioCfg = const AudioConfig();

  @override
  void initState() {
    super.initState();
    final args = ModalRoute.of(context)?.settings.arguments;
    final argMap = args is Map ? Map<String, dynamic>.from(args) : {};
    _targetPeerId = argMap['targetPeerId'] as String?;
    _client = argMap['client'] as QiniuDirectClient?;

    if (_targetPeerId != null && _client != null) {
      VoiceUiConfig.load().then((c) { if (mounted) setState(() => _uiVoice = c); });
      _signalTimer = Timer.periodic(const Duration(seconds: 2), (_) => _pollResponse());
    }

    if (argMap['selfTest'] == 'true') {
      _initSelfTest();
    }
  }

  Future<void> _initSelfTest() async {
    final prefs = await SharedPreferences.getInstance();
    final peerId = prefs.getString('peerId') ?? '${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999).toString().padLeft(5, '0')}';
    if (_client == null) _client = QiniuDirectClient(peerId: peerId);
    await _client!.register();
    _targetPeerId = peerId;
    final cfg = await AudioConfig.load();
    if (mounted) {
      setState(() => _state = 'calling');
      Future.delayed(Duration(milliseconds: cfg.demoDelayMs), () {
        if (mounted && _state == 'calling') {
          setState(() => _state = 'connected');
          _startAudio();
        }
      });
    }
  }

  Future<void> _pollResponse() async {
    if (_state == 'ended') return;
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
    } catch (_) {}
  }

  bool _audioStarted = false;

  void _acceptCall() {
    _client?.sendSignal(_targetPeerId!, 'call-accept');
    if (mounted) setState(() => _state = 'connected');
    _startAudio();
  }

  void _endCall() {
    _audioStarted = false;
    _recordSub?.cancel();
    _recorder?.dispose();
    _player?.dispose();
    _processor?.dispose();
    _client?.sendSignal(_targetPeerId!, 'call-end');
    if (mounted) setState(() => _state = 'ended');
    _signalTimer?.cancel();
    Navigator.pop(context);
  }


  Future<void> _startAudio() async {
    if (_audioStarted) return;
    _audioStarted = true;
    final cfg = await AudioConfig.load();
    _audioCfg = cfg;
    _recorder = AudioRecorder();
    _player = AudioPlayer();
    _processor = AudioProcessor(sampleRate: cfg.sampleRate, enableDenoise: cfg.denoise, enableCodec: cfg.mode != 'raw');
    await _processor!.initialize();
    if (cfg.mode == 'opus') _processor!.setMode(AudioMode.opus);
    if (cfg.mode == 'neural') _processor!.setMode(AudioMode.neural);

    if (await _recorder!.hasPermission() != true) return;

    final stream = await _recorder!.startStream(RecordConfig(
      encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: cfg.sampleRate));
    if (stream == null) return;

    // Send: record → process → upload
    final bufSize = cfg.bufferBytes;
    final fadeBytes = cfg.fadeBytes; // 5ms cross-fade @ 24000Hz 16bit mono
    List<int> _buffer = [];
    Uint8List? _prevOverlap;
    _recordSub = stream.listen((chunk) async {
      if (_muted || _state != 'connected') {
        _buffer.clear();
        return;
      }
      _buffer.addAll(chunk);
      if (_buffer.length >= bufSize) {
        var frame = Uint8List.fromList(_buffer.take(bufSize).toList());
        _buffer = _buffer.skip(bufSize).toList();
        // Cross-fade with previous chunk tail to avoid click
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
          await _client?.sendEncodedAudio(_targetPeerId!, processed, _audioSeq++);
        }
      }
    }, onError: (_) {});

    // Receive: poll every cfg.pollMs, queue chunks for sequential playback
    _signalTimer?.cancel();
    _signalTimer = Timer.periodic(Duration(milliseconds: cfg.pollMs), (_) async {
      if (_state != 'connected') return;
      try {
        final chunks = await _client!.pollEncodedAudio();
        if (chunks.isEmpty) return;
        for (final c in chunks) {
          final pcm = await _processor?.processReceivedAudio(c);
          if (pcm != null) _playQueue.add(pcm);
        }
        if (!_playing) _playNext();
      } catch (_) {}
    });
  }

  Future<void> _playNext() async {
    if (_playQueue.isEmpty || !mounted) { _playing = false; return; }
    _playing = true;
    var pcm = _playQueue.removeAt(0);
    // 2ms fade-in/out to prevent click at chunk boundaries
    final fadeSamples = _audioCfg.fadeSamples; // 2ms @ 24000Hz
    for (int i = 0; i < fadeSamples && i * 2 < pcm.length; i++) {
      final ratio = i / fadeSamples;
      final idx = i * 2;
      var v = pcm[idx] | (pcm[idx + 1] << 8);
      var s = v > 32767 ? v - 65536 : v;
      s = (s * ratio).round().clamp(-32768, 32767);
      final b = s < 0 ? s + 65536 : s;
      pcm[idx] = b & 0xFF; pcm[idx + 1] = (b >> 8) & 0xFF;
    }
    for (int i = 0; i < fadeSamples && pcm.length >= (i + 1) * 2; i++) {
      final ratio = i / fadeSamples;
      final idx = pcm.length - (i + 1) * 2;
      var v = pcm[idx] | (pcm[idx + 1] << 8);
      var s = v > 32767 ? v - 65536 : v;
      s = (s * ratio).round().clamp(-32768, 32767);
      final b = s < 0 ? s + 65536 : s;
      pcm[idx] = b & 0xFF; pcm[idx + 1] = (b >> 8) & 0xFF;
    }
    final wav = QiniuDirectClient.wavFromPcm(pcm);
    final player = _player;
    if (player != null) {
      player.onPlayerComplete.first.then((_) => _playNext());
      await player.play(BytesSource(wav));
    }
  }

  @override
  void dispose() {
    _recordSub?.cancel();
    _recorder?.dispose();
    _player?.dispose();
    _processor?.dispose();
    _signalTimer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    return Scaffold(
      backgroundColor: theme.background,
      body: SafeArea(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 120, height: 120,
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(40),
                boxShadow: theme.useGlow ? [BoxShadow(color: theme.primary.withValues(alpha: 0.5), blurRadius: 40, spreadRadius: 5)] : null,
              ),
              child: const Icon(Icons.mic_rounded, color: Colors.white, size: 48),
            ),
            const SizedBox(height: 24),
            Text(
              _state == 'calling' ? _uiVoice.calling(_targetPeerId ?? '') :
              _state == 'ringing' ? _uiVoice.ringingText :
              _state == 'connected' ? _uiVoice.connected(_targetPeerId ?? '') : _uiVoice.endedText,
              style: TextStyle(color: theme.textPrimary, fontSize: 20, fontWeight: FontWeight.w600),
            ),
            if (_state == 'connected')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _muted ? _uiVoice.mutedLabel : _uiVoice.relayLabel,
                  style: TextStyle(color: theme.textTertiary, fontSize: 12),
                ),
              ),
            const SizedBox(height: 32),
            if (_state == 'ringing')
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                _ctrlBtn(Icons.call, theme.success, _acceptCall),
                const SizedBox(width: 40),
                _ctrlBtn(Icons.call_end, theme.error, _endCall, big: true),
              ]),
            if (_state == 'calling')
              _ctrlBtn(Icons.call_end, theme.error, _endCall, big: true),
            if (_state == 'connected')
              Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                _ctrlBtn(_muted ? Icons.mic_off : Icons.mic, theme.primary, () => setState(() => _muted = !_muted)),
                const SizedBox(width: 40),
                _ctrlBtn(Icons.call_end, theme.error, _endCall, big: true),
              ]),
          ],
        ),
      ),
    );
  }

  Widget _ctrlBtn(IconData icon, Color color, VoidCallback onTap, {bool big = false}) {
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
