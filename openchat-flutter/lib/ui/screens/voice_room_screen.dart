import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';

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

  @override
  void initState() {
    super.initState();
    final args = ModalRoute.of(context)?.settings.arguments as Map?;
    _targetPeerId = args?['targetPeerId'] as String?;
    _client = args?['client'] as QiniuDirectClient?;

    if (_targetPeerId != null && _client != null) {
      _signalTimer = Timer.periodic(const Duration(seconds: 2), (_) => _pollResponse());
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
    _client?.sendSignal(_targetPeerId!, 'call-end');
    if (mounted) setState(() => _state = 'ended');
    _signalTimer?.cancel();
    Navigator.pop(context);
  }

  Future<void> _startAudio() async {
    if (_audioStarted) return;
    _audioStarted = true;
    _recorder = AudioRecorder();
    _player = AudioPlayer();

    if (await _recorder!.hasPermission() != true) return;

    final stream = await _recorder!.startStream(const RecordConfig(
      encoder: AudioEncoder.pcm16bits, numChannels: 1, sampleRate: 24000));
    if (stream == null) return;

    // Send: record → periodic send
    List<int> _buffer = [];
    _recordSub = stream.listen((chunk) {
      if (_muted || _state != 'connected') {
        _buffer.clear(); // discard while muted, prevent OOM
        return;
      }
      _buffer.addAll(chunk);
      if (_buffer.length >= 2880) {
        final frame = Uint8List.fromList(_buffer.take(2880).toList());
        _buffer = _buffer.skip(2880).toList();
        _client?.sendAudio(_targetPeerId!, frame, _audioSeq++);
      }
    }, onError: (_) {});

    // Receive: poll every 800ms
    _signalTimer?.cancel();
    _signalTimer = Timer.periodic(const Duration(milliseconds: 800), (_) async {
      if (_state != 'connected') return;
      try {
        final data = await _client!.pollAudio();
        if (data != null && data.isNotEmpty) {
          await _player?.play(BytesSource(Uint8List.fromList(data)));
        }
      } catch (_) {}
    });
  }

  @override
  void dispose() {
    _recordSub?.cancel();
    _recorder?.dispose();
    _player?.dispose();
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
