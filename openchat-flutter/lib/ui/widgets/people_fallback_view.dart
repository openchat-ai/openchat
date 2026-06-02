import 'package:flutter/material.dart';
import '../../core/api/qiniu_direct_client.dart';
import '../../core/theme/app_theme.dart';
import 'people_error_view.dart';

class PeopleFallbackView extends StatelessWidget {
  final bool loading;
  final String? error;
  final List<Map<String, dynamic>> users;
  final QiniuDirectClient? client;
  final AppTheme theme;
  final VoidCallback onRefresh;
  final VoidCallback onSpawnDemo;
  final void Function(String peerId) onCall;

  const PeopleFallbackView({
    super.key,
    required this.loading,
    required this.error,
    required this.users,
    required this.client,
    required this.theme,
    required this.onRefresh,
    required this.onSpawnDemo,
    required this.onCall,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent, elevation: 0,
        title: Text('People', style: TextStyle(color: theme.textPrimary)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: onRefresh, color: theme.textSecondary)],
      ),
      body: loading
          ? Center(child: CircularProgressIndicator(color: theme.accent))
          : error != null
              ? PeopleErrorView(error: error, theme: theme, onRetry: onRefresh)
              : users.isEmpty
                  ? Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.person_outline, color: theme.textTertiary, size: 48),
                      const SizedBox(height: 16),
                      Text('No one online', style: TextStyle(color: theme.textSecondary)),
                      const SizedBox(height: 8),
                      Text('Tap Demo to test with a simulated user',
                          style: TextStyle(color: theme.textTertiary, fontSize: 12)),
                      const SizedBox(height: 16),
                      ElevatedButton.icon(
                        onPressed: client == null ? null : onSpawnDemo,
                        icon: const Icon(Icons.smart_toy_outlined, size: 16),
                        label: const Text('Demo'),
                      ),
                    ]))
                  : RefreshIndicator(
                      onRefresh: onRefresh,
                      child: ListView.builder(
                        itemCount: users.length,
                        itemBuilder: (ctx, i) {
                          final user = users[i];
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
                              onPressed: () => onCall(peerId),
                            ),
                            onTap: () => onCall(peerId),
                          );
                        },
                      ),
                    ),
    );
  }
}
