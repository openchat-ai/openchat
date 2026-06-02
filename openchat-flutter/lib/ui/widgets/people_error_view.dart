import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class PeopleErrorView extends StatelessWidget {
  final String? error;
  final AppTheme theme;
  final VoidCallback onRetry;

  const PeopleErrorView({
    super.key,
    required this.error,
    required this.theme,
    required this.onRetry,
  });

  @override
  Widget build(BuildContext context) {
    final err = error ?? '';
    String type, hint;
    if (err.contains('Timeout') || err.contains('timed out')) {
      type = 'Network timeout';
      hint = 'Check your internet connection\nQiniu may be blocked by your ISP';
    } else if (err.contains('401') || err.contains('bad token') || err.contains('BadToken')) {
      type = 'Auth failed';
      hint = 'Upload token invalid\nRebuild APK to refresh token';
    } else if (err.contains('403') || err.contains('Signature')) {
      type = 'Signature mismatch';
      hint = 'S3 signing algorithm mismatch\nContact developer';
    } else if (err.contains('SocketException') || err.contains('Connection refused')) {
      type = 'Connection failed';
      hint = 'Cannot reach Qiniu server\nCheck firewall or try different network';
    } else if (err.contains('DNS')) {
      type = 'DNS resolution failed';
      hint = 'Cannot resolve qiniu.com\nCheck DNS settings';
    } else if (err.contains('InvalidAccessKeyId')) {
      type = 'Access key invalid';
      hint = 'Qiniu access key rejected\n$err';
    } else {
      type = 'Unknown error';
      hint = err;
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
              child: Text(err, style: TextStyle(color: theme.textTertiary, fontSize: 10), textAlign: TextAlign.center),
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
