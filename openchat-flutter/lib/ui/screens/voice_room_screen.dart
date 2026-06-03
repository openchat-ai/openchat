import 'dart:async';
import 'dart:developer' show log;
import 'dart:math' hide log;
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/audio/audio.dart';
import '../../core/ui_voice_config.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';
import '../components/resident/resident_music_score.dart';
import '../../core/theme/app_theme.dart';
import 'voice_room_audio.dart';
import 'voice_room_widgets.dart';

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
