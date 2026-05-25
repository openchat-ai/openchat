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

  @override
  void initState() {
    super.initState();
    final args = ModalRoute.of(context)?.settings.arguments;
    final argMap = args is Map ? Map<String, dynamic>.from(args) : {};
    _targetPeerId = argMap['targetPeerId'] as String?;
    _client = argMap['client'] as QiniuDirectClient?;

    if (_targetPeerId != null && _client != null) {
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
    if (mounted) {
      setState(() => _state = 'calling');
      Future.delayed(const Duration(seconds: 3), () {
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
    _recorder = AudioRecorder();
    _player = AudioPlayer();
    _processor = AudioProcessor(sampleRate: cfg.sampleRate, enableDenoise: cfg.denoise, enableCodec: cfg.mode != 'raw');
    await _processor!.initialize();
    if (cfg.mode == 'raw') _processor!.setMode(AudioMode.raw);

    if (await _recorder!.hasPermission() != true) return;

    final stream = await _recorder!.startStream(RecordConfig(
      encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: cfg.sampleRate));
    if (stream == null) return;

    // Send: record → process (RNNoise → AGC → Neural Codec) → upload
    final bufSize = cfg.bufferBytes;
    List<int> _buffer = [];
    _recordSub = stream.listen((chunk) async {
      if (_muted || _state != 'connected') {
        _buffer.clear();
        return;
      }
      _buffer.addAll(chunk);
      if (_buffer.length >= bufSize) {
        final frame = Uint8List.fromList(_buffer.take(bufSize).toList());
        _buffer = _buffer.skip(bufSize).toList();
        final processed = await _processor?.processMicrophoneInput(frame);
        if (processed != null) {
          await _client?.sendEncodedAudio(_targetPeerId!, processed, _audioSeq++);
        }
      }
    }, onError: (_) {});

    // Receive: poll every cfg.pollMs
    _signalTimer?.cancel();
    _signalTimer = Timer.periodic(Duration(milliseconds: cfg.pollMs), (_) async {
      if (_state != 'connected') return;
      try {
        final chunks = await _client!.pollEncodedAudio();
        if (chunks.isEmpty) return;
        // Decode and concatenate all chunks into one WAV
        int totalLen = 0;
        final decodedChunks = <Uint8List>[];
        for (final chunk in chunks) {
          final pcm = await _processor?.processReceivedAudio(chunk);
          if (pcm != null) decodedChunks.add(pcm);
          totalLen += pcm?.length ?? 0;
        }
        if (decodedChunks.isEmpty) return;
        final merged = Uint8List(totalLen);
        int offset = 0;
        for (final pcm in decodedChunks) {
          merged.setRange(offset, offset + pcm.length, pcm);
          offset += pcm.length;
        }
        final wav = QiniuDirectClient.wavFromPcm(merged);
        await _player?.stop();
        await _player?.play(BytesSource(wav));
      } catch (_) {}
    });
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
              _state == 'calling' ? 'Calling $_targetPeerId...' :
              _state == 'ringing' ? 'Incoming call...' :
              _state == 'connected' ? 'Connected to $_targetPeerId' : 'Call ended',
              style: TextStyle(color: theme.textPrimary, fontSize: 20, fontWeight: FontWeight.w600),
            ),
            if (_state == 'connected')
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  _muted ? 'MUTED' : 'Qiniu relay',
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
