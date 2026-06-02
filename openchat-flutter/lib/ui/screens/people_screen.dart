import 'package:shared_preferences/shared_preferences.dart';
import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui_config.dart';
import '../../core/ui_voice_config.dart';
import '../widgets/people_sdui_view.dart';
import '../widgets/people_fallback_view.dart';
import '../widgets/people_action_dispatcher.dart';

class PeopleScreen extends ConsumerStatefulWidget {
  const PeopleScreen({super.key});

  @override
  ConsumerState<PeopleScreen> createState() => _PeopleScreenState();
}

class _PeopleScreenState extends ConsumerState<PeopleScreen> {
  QiniuDirectClient? _client;
  List<Map<String, dynamic>> _users = [];
  String? _error;
  bool _loading = true;
  bool _refreshing = false;
  Timer? _pollTimer;
  Map? _uiConfig;
  int _lastHeartbeatMs = 0;
  static const int _heartbeatIntervalMs = 30000;
  VoiceUiConfig _uiVoice = const VoiceUiConfig();
  @override
  void initState() {
    super.initState();
    VoiceUiConfig.load().then((c) { if (mounted) setState(() => _uiVoice = c); });
    _init();
  }

  Future<void> _init() async {
    final prefs = await SharedPreferences.getInstance();
    String? peerId = prefs.getString('peerId');
    if (peerId == null) {
      try {
        final host = Platform.localHostname;
        if (host.isNotEmpty) peerId = host.replaceAll(RegExp(r'[^a-zA-Z0-9_-]'), '_');
      } catch (_) {}
      peerId ??= '${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999).toString().padLeft(5, '0')}';
      await prefs.setString('peerId', peerId);
    }
    _client = QiniuDirectClient(peerId: peerId);
    try {
      await _client!.register().timeout(const Duration(seconds: 8));
      await _client!.fetchConfig().timeout(const Duration(seconds: 8));
      _uiConfig = await sduiSource.load('people')
          .timeout(const Duration(seconds: 8));
      _pollTimer = Timer.periodic(Duration(milliseconds: _client!.pollIntervalMs), (_) => _pollUsers());
      await _pollUsers().timeout(const Duration(seconds: 10));
    } catch (e) {
      _client?.dispose();
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }
  void _startPoll() {
    if (_client == null) return;
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(Duration(milliseconds: _client!.pollIntervalMs), (_) => _pollUsers());
  }
  @override
  void dispose() {
    _pollTimer?.cancel();
    _client?.unregisterAndDispose();
    super.dispose();
  }
  Future<void> _pollUsers() async {
    if (!mounted) return;
    setState(() => _refreshing = true);
    try {
      final users = await _client!.discoverUsers().timeout(const Duration(seconds: 8));
      if (!mounted) return;
      setState(() {
        _users = users.where((u) => u['peerId'] != _client!.peerId).toList();
        _error = null;
        _loading = false;
      });
      if (_uiConfig == null) {
        final newConfig = await sduiSource.load('people')
            .timeout(const Duration(seconds: 5));
        if (newConfig != null) _uiConfig = newConfig;
      }
      final signals = await _client!.pollIncoming().timeout(const Duration(seconds: 8));
      for (final s in signals) {
        final action = s['action'] as String?;
        final from = s['fromPeerId'] as String?;
        if (action == 'call-request' && from != null && mounted) _showIncomingCall(from);
      }
      final nowMs = DateTime.now().millisecondsSinceEpoch;
      if (nowMs - _lastHeartbeatMs >= _heartbeatIntervalMs) {
        _lastHeartbeatMs = nowMs;
        await _client!.heartbeat().timeout(const Duration(seconds: 8));
      }
      await _client!.pollDebug().timeout(const Duration(seconds: 8));
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
    if (!mounted) return;
    setState(() => _refreshing = false);
  }

  void _showIncomingCall(String fromPeerId) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: Text(_uiVoice.incomingTitle),
        content: Text(_uiVoice.incomingBody_(fromPeerId)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: Text(_uiVoice.declineLabel)),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              _pollTimer?.cancel();
              Navigator.pushNamed(context, '/voice', arguments: {
                'targetPeerId': fromPeerId,
                'client': _client,
              }).then((_) => _startPoll());
            },
            child: Text(_uiVoice.acceptLabel),
          ),
        ],
      ),
    );
  }
  void _callUser(String targetPeerId) async {
    if (_client == null) return;
    final isLoopback = targetPeerId == _client!.peerId || targetPeerId == 'demo_user';
    try {
      if (!isLoopback) {
        await _client!.sendSignal(targetPeerId, 'call-request');
      }
      if (mounted) {
        _pollTimer?.cancel();
        Navigator.pushNamed(context, '/voice', arguments: {
          'targetPeerId': targetPeerId,
          'client': _client,
          if (isLoopback) 'selfTest': 'true',
        }).then((_) => _startPoll());
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Call failed'), duration: Duration(seconds: 2)),
        );
      }
    }
  }
  Future<void> _spawnDemo() async {
    if (_client == null) return;
    await _client!.spawnDemoPeer();
    await _pollUsers();
  }
  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);
    if (_uiConfig != null && !_loading && _error == null) {
      try {
        return PeopleSduiView(
          users: _users,
          uiConfig: _uiConfig!,
          client: _client!,
          theme: theme,
          onRefresh: _pollUsers,
          onAction: (action) => PeopleActionDispatcher.handle(
            action,
            SduiActionContext(
              context: context,
              users: _users,
              client: _client,
              uiConfig: _uiConfig,
              onPollUsers: _pollUsers,
              onCall: _callUser,
            ),
          ),
        );
      } catch (_) {}
    }
    return PeopleFallbackView(
      loading: _loading,
      error: _error,
      users: _users,
      client: _client,
      theme: theme,
      onRefresh: _pollUsers,
      onSpawnDemo: _spawnDemo,
      onCall: _callUser,
    );
  }
}
