import 'package:shared_preferences/shared_preferences.dart';
import 'dart:convert';
import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui.dart';
import '../../core/sdui_config.dart';
import '../../core/sdui_actions.dart';

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

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getString('peerId');
    final peerId = stored ?? '${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999).toString().padLeft(5, '0')}';
    if (stored == null) await prefs.setString('peerId', peerId);
    _client = QiniuDirectClient(peerId: peerId);
    try {
      await _client!.register().timeout(const Duration(seconds: 8));
      await _client!.fetchConfig().timeout(const Duration(seconds: 8));
      _uiConfig = await SduiConfig.load('oc/config/ui_people.json', peerId: peerId)
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
      final newConfig = await SduiConfig.load('oc/config/ui_people.json', peerId: _client!.peerId)
          .timeout(const Duration(seconds: 5));
      if (newConfig != null) _uiConfig = newConfig;
      final signals = await _client!.pollIncoming().timeout(const Duration(seconds: 8));
      for (final s in signals) {
        final action = s['action'] as String?;
        final from = s['fromPeerId'] as String?;
        if (action == 'call-request' && from != null && mounted) _showIncomingCall(from);
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
        title: const Text('Incoming Call'),
        content: Text('$fromPeerId is calling...'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Decline')),
          ElevatedButton(
            onPressed: () {
              Navigator.pop(ctx);
              _pollTimer?.cancel();
              Navigator.pushNamed(context, '/voice', arguments: {
                'targetPeerId': fromPeerId,
                'client': _client,
              }).then((_) => _startPoll());
            },
            child: const Text('Accept'),
          ),
        ],
      ),
    );
  }

  void _callUser(String targetPeerId) async {
    if (_client == null) return;
    try {
      await _client!.sendSignal(targetPeerId, 'call-request');
      if (mounted) {
        _pollTimer?.cancel();
        Navigator.pushNamed(context, '/voice', arguments: {
          'targetPeerId': targetPeerId,
          'client': _client,
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

  void _handleFileAction(String action) {
    if (_client == null) return;
    if (action.startsWith('file:list?')) {
      final qIdx = action.indexOf('?');
      final prefix = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1))['prefix'] ?? '' : '';
      _client!.listFiles(prefix).then((files) {
        if (!mounted) return;
        showDialog(context: context, builder: (ctx) => AlertDialog(
          title: Text('Files: $prefix'),
          content: SizedBox(width: double.maxFinite,
            child: ListView.builder(shrinkWrap: true, itemCount: files.length,
              itemBuilder: (_, i) => ListTile(title: Text(files[i].split('/').last, style: const TextStyle(fontSize: 12)), dense: true)),
          ),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
        ));
      });
    } else if (action.startsWith('file:delete?')) {
      final qIdx = action.indexOf('?');
      final key = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1))['key'] ?? '' : '';
      if (key.isEmpty) return;
      showDialog(context: context, builder: (ctx) => AlertDialog(
        title: const Text('Delete?'), content: Text(key),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(onPressed: () { _client!.deleteFile(key); Navigator.pop(ctx); },
            child: const Text('Delete', style: TextStyle(color: Colors.red))),
        ],
      ));
    } else if (action.startsWith('file:get?')) {
      final qIdx = action.indexOf('?');
      final key = qIdx >= 0 ? Uri.splitQueryString(action.substring(qIdx + 1))['key'] ?? '' : '';
      if (key.isEmpty) return;
      _client!.readFile(key).then((data) {
        if (!mounted || data == null) return;
        showDialog(context: context, builder: (ctx) => AlertDialog(
          title: Text(key.split('/').last),
          content: SizedBox(width: double.maxFinite,
            child: SingleChildScrollView(child: Text(data, style: const TextStyle(fontSize: 10)))),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
        ));
      });
    } else if (action.startsWith('file:write?')) {
      final qIdx = action.indexOf('?');
      if (qIdx < 0) return;
      final params = Uri.splitQueryString(action.substring(qIdx + 1));
      final key = params['key'] ?? '';
      final value = params['value'] ?? '';
      if (key.isEmpty || value.isEmpty) return;
      _client!.writeFile(key, value).then((ok) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(ok ? 'Written: $key' : 'Write failed: $key')));
      });
    } else if (action.startsWith('config:set?')) {
      _handleConfigSet(action);
    }
  }

  Future<void> _handleConfigSet(String action) async {
    final qIdx = action.indexOf('?');
    if (qIdx < 0) return;
    final params = Uri.splitQueryString(action.substring(qIdx + 1));
    final key = params['key'];
    final value = params['value'];
    if (key == null || value == null) return;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Config set: $key=$value')));
  }

  Future<void> _showConfig() async {
    final prefs = await SharedPreferences.getInstance();
    final keys = ['peerId', 'bridge_url', 'theme_mode'].where((k) => prefs.containsKey(k));
    final items = keys.map((k) => Text('$k: ${prefs.get(k)}', style: const TextStyle(fontSize: 13))).toList();
    if (items.isEmpty) items.add(const Text('(no config)'));
    if (!mounted) return;
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Config'), content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: items),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
    ));
  }

  void _restartApp() {
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Restart'), content: const Text('Restart app for changes to take effect'),
      actions: [TextButton(onPressed: () {
        Navigator.pop(ctx);
        Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => const Scaffold(body: Center(child: CircularProgressIndicator()))), (r) => false);
        Future.delayed(const Duration(milliseconds: 100), () => Navigator.of(context).pushReplacementNamed('/'));
      }, child: const Text('OK'))],
    ));
  }

  Future<void> _showAudioFiles() async {
    if (_client == null) return;
    final files = await _client!.listAudioFiles();
    if (!mounted) return;
    if (files.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('No audio files')));
      return;
    }
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Audio Files'),
        content: SizedBox(
          width: double.maxFinite,
          child: ListView.builder(
            shrinkWrap: true,
            itemCount: files.length,
            itemBuilder: (_, i) => ListTile(
              title: Text(files[i].split('/').last, style: const TextStyle(fontSize: 12)),
              dense: true,
            ),
          ),
        ),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
      ),
    );
  }

  void _showDeviceInfo() {
    if (_client == null) return;
    showDialog(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Device Info'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Peer ID: ${_client!.peerId}'),
        const SizedBox(height: 8),
        Text('Poll: ${_client!.pollIntervalMs}ms'),
      ]),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
    ));
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _client?.unregister();
    _client?.dispose();
    super.dispose();
  }

  Widget _buildErrorView(AppTheme theme) {
    final error = _error ?? '';
    String type, hint;
    if (error.contains('Timeout') || error.contains('timed out')) {
      type = 'Network timeout';
      hint = 'Check your internet connection\nQiniu may be blocked by your ISP';
    } else if (error.contains('401') || error.contains('bad token') || error.contains('BadToken')) {
      type = 'Auth failed';
      hint = 'Upload token invalid\nRebuild APK to refresh token';
    } else if (error.contains('403') || error.contains('Signature')) {
      type = 'Signature mismatch';
      hint = 'S3 signing algorithm mismatch\nContact developer';
    } else if (error.contains('SocketException') || error.contains('Connection refused')) {
      type = 'Connection failed';
      hint = 'Cannot reach Qiniu server\nCheck firewall or try different network';
    } else if (error.contains('DNS')) {
      type = 'DNS resolution failed';
      hint = 'Cannot resolve qiniu.com\nCheck DNS settings';
    } else {
      type = 'Unknown error';
      hint = 'Could not connect to OpenChat\nCheck your network and try again';
    }
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.cloud_off, color: theme.warning, size: 48),
            const SizedBox(height: 16),
            Text(type, style: TextStyle(color: theme.error, fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            Text(hint, style: TextStyle(color: theme.textSecondary, fontSize: 13), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.surface.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(error, style: TextStyle(color: theme.textTertiary, fontSize: 10), textAlign: TextAlign.center),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: _pollUsers,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSdui(AppTheme theme) {
    // If no users online, show empty state with Demo button (via SDUI if config includes it, else fallback)
    if (_users.isEmpty) {
      return Scaffold(
        backgroundColor: theme.background,
        appBar: AppBar(
          backgroundColor: Colors.transparent, elevation: 0,
          title: Text('People', style: TextStyle(color: theme.textPrimary)),
          actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _pollUsers, color: theme.textSecondary)],
        ),
        body: Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.person_outline, color: theme.textTertiary, size: 48),
          const SizedBox(height: 16),
          Text('No one online', style: TextStyle(color: theme.textSecondary)),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _client == null ? null : () async {
              await _client!.spawnDemoPeer();
              await _pollUsers();
            },
            icon: const Icon(Icons.smart_toy_outlined, size: 16),
            label: const Text('Demo'),
          ),
        ])),
      );
    }
    final parser = SduiParser(
      vars: {'peerId': _client!.peerId, 'userCount': _users.length},
      onReadFile: (key) => _client!.readFile(key),
      onAction: (action) {
        for (final u in _users) {
          if (action == 'call:${u['peerId']}') {
            _callUser(u['peerId'] as String);
            return;
          }
        }
        SduiActions.handle(context, action,
          onRefresh: _pollUsers,
          onDemo: () => _client?.spawnDemoPeer().then((_) => _pollUsers()),
          custom: {
            'settings': () => Navigator.pushNamed(context, '/theme'),
            'audio_files': () => _showAudioFiles(),
            'device:info': () => _showDeviceInfo(),
            'config:get': () => _showConfig(),
            'app:restart': () => _restartApp(),
          },
        );
        // Handle generic file operations (file:list?prefix=..., file:delete?key=..., file:get?key=...)
        _handleFileAction(action);
      },
    );
    // Inject user list into config
    if (_uiConfig!['children'] is List) {
      for (int i = 0; i < (_uiConfig!['children'] as List).length; i++) {
        final child = (_uiConfig!['children'] as List)[i];
        if (child is Map && child['type'] == 'users_list') {
          (_uiConfig!['children'] as List)[i] = {
            'type': 'column', 'children': _users.map((u) => {
              'type': 'list_tile',
              'leadingIcon': 'person',
              'title': u['peerId'],
              'subtitle': 'Online',
              'trailingIcon': 'call',
              'trailingAction': 'call:${u['peerId']}',
              'action': 'call:${u['peerId']}',
            }).toList(),
          };
        }
      }
    }
    final rendered = parser.parse(_uiConfig);
    if (rendered == null) return const SizedBox();
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('People', style: TextStyle(color: theme.textPrimary)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _pollUsers, color: theme.textSecondary)],
      ),
      body: rendered,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    // If remote UI config exists, use SDUI (change ui_people.json in Qiniu to update UI without rebuild)
    if (_uiConfig != null && !_loading && _error == null) {
      Widget? sduiWidget;
      try {
        sduiWidget = _buildSdui(theme);
      } catch (_) {}
      if (sduiWidget != null) return sduiWidget;
    }

    // Fallback hardcoded UI
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('People', style: TextStyle(color: theme.textPrimary)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _pollUsers, color: theme.textSecondary)],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: theme.accent))
          : _error != null
              ? _buildErrorView(theme)
              : _users.isEmpty
                  ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.person_outline, color: theme.textTertiary, size: 48),
                      const SizedBox(height: 16),
                      Text('No one online', style: TextStyle(color: theme.textSecondary)),
                      const SizedBox(height: 8),
                      Text('Tap Demo to test with a simulated user',
                          style: TextStyle(color: theme.textTertiary, fontSize: 12)),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: _client == null ? null : () async {
                          await _client!.spawnDemoPeer();
                          await _pollUsers();
                        },
                        icon: const Icon(Icons.smart_toy_outlined, size: 16),
                        label: const Text('Demo'),
                      ),
                    ]))
                  : RefreshIndicator(
                      onRefresh: _pollUsers,
                      child: ListView.builder(
                        itemCount: _users.length,
                        itemBuilder: (ctx, i) {
                          final user = _users[i];
                          final peerId = user['peerId'] as String? ?? 'unknown';
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: theme.accent.withValues(alpha: 0.2),
                              child: Icon(Icons.person, color: theme.accent),
                            ),
                            title: Text(peerId, style: TextStyle(color: theme.textPrimary)),
                            subtitle: Text('Online', style: TextStyle(color: theme.success, fontSize: 12)),
                            trailing: IconButton(
                              icon: Icon(Icons.call, color: theme.gradientAccent[0]),
                              onPressed: () => _callUser(peerId),
                            ),
                            onTap: () => _callUser(peerId),
                          );
                        },
                      ),
                    ),
    );
  }
}
