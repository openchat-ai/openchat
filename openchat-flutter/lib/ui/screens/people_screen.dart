import 'dart:convert';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/sdui.dart';

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
    final peerId = 'phone_${DateTime.now().millisecondsSinceEpoch}';
    _client = QiniuDirectClient(peerId: peerId);
    try {
      await _client!.register().timeout(const Duration(seconds: 8));
      await _client!.fetchConfig();
      _uiConfig = await _client!.fetchRemoteUi();
      _pollTimer = Timer.periodic(Duration(milliseconds: _client!.pollIntervalMs), (_) => _pollUsers());
      await _pollUsers();
    } catch (e) {
      _client?.dispose();
      if (mounted) setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _pollUsers() async {
    if (!mounted) return;
    setState(() => _refreshing = true);
    try {
      final users = await _client!.discoverUsers();
      if (!mounted) return;
      setState(() {
        _users = users.where((u) => u['peerId'] != _client!.peerId).toList();
        _error = null;
        _loading = false;
      });
      final newConfig = await _client!.fetchRemoteUi();
      if (newConfig != null) _uiConfig = newConfig;
      final signals = await _client!.pollIncoming();
      for (final s in signals) {
        final from = s['fromPeerId'] as String?;
        if (from != null && mounted) _showIncomingCall(from);
      }
      await _client!.pollDebug();
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
              Navigator.pushNamed(context, '/voice', arguments: {
                'targetPeerId': fromPeerId,
                'client': _client,
              });
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
        Navigator.pushNamed(context, '/voice', arguments: {
          'targetPeerId': targetPeerId,
          'client': _client,
        });
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Call failed'), duration: Duration(seconds: 2)),
        );
      }
    }
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
    final parser = SduiParser(onAction: (action) {
      if (action == 'refresh') _pollUsers();
      for (final u in _users) {
        if (action == 'call:${u['peerId']}') {
          _callUser(u['peerId'] as String);
          return;
        }
      }
    });
    // Inject user list into config
    if (_uiConfig!['children'] is List) {
      for (int i = 0; i < (_uiConfig!['children'] as List).length; i++) {
        final child = (_uiConfig!['children'] as List)[i];
        if (child is Map && child['type'] == 'users_list') {
          (_uiConfig!['children'] as List)[i] = {
            'type': 'column', 'children': _users.map((u) => {
              'type': 'button', 'content': u['peerId'],
              'action': 'call:${u['peerId']}',
              'pad': 4,
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

    // If remote UI config exists, use SDUI
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
