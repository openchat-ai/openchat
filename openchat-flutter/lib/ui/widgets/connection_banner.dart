import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/theme_provider.dart';
import '../../providers/bridge_provider.dart';

class ConnectionBanner extends ConsumerWidget {
  const ConnectionBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final connected = ref.watch(bridgeConnectionProvider);
    final theme = ref.watch(currentThemeProvider);

    return connected.when(
      data: (isConnected) {
        if (isConnected) return const SizedBox.shrink();
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: theme.error.withValues(alpha: 0.9),
          child: Row(
            children: [
              const Icon(Icons.cloud_off, color: Colors.white, size: 16),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Bridge 未连接',
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                ),
              ),
              TextButton(
                onPressed: () {
                  ref.read(bridgeWsProvider).connect();
                },
                style: TextButton.styleFrom(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  foregroundColor: Colors.white,
                ),
                child: const Text('重试', style: TextStyle(fontSize: 12)),
              ),
            ],
          ),
        );
      },
      loading: () => const SizedBox.shrink(),
      error: (_, __) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        color: Colors.orange.shade800,
        child: const Row(
          children: [
            Icon(Icons.error_outline, color: Colors.white, size: 16),
            SizedBox(width: 8),
            Text('连接异常', style: TextStyle(color: Colors.white, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
