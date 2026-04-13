import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/ui/theme/colors.dart';

final isBridgeConnectedProvider = StateProvider<bool>((ref) => false);
final bridgeActiveSessionsProvider = StateProvider<int>((ref) => 0);

class BridgeStatusScreen extends ConsumerWidget {
  const BridgeStatusScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isConnected = ref.watch(isBridgeConnectedProvider);
    final activeSessions = ref.watch(bridgeActiveSessionsProvider);

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(title: const Text('Bridge Status')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildStatusCard(context, isConnected),
          const SizedBox(height: 24),
          _buildSessionsSection(context, activeSessions),
          const SizedBox(height: 24),
          _buildInfoSection(context),
        ],
      ),
    );
  }

  Widget _buildStatusCard(BuildContext context, bool isConnected) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: AppColors.surfaceDark,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Icon(
            isConnected ? Icons.cloud_done : Icons.cloud_off,
            size: 64,
            color: isConnected ? AppColors.success : AppColors.error,
          ),
          const SizedBox(height: 16),
          Text(
            isConnected ? 'Bridge Connected' : 'Bridge Disconnected',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            isConnected
                ? 'Your AI sessions are active'
                : 'Connect to enable AI features',
            style: const TextStyle(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }

  Widget _buildSessionsSection(BuildContext context, int sessions) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'ACTIVE SESSIONS',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surfaceDark,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              const Icon(Icons.smart_toy, color: AppColors.secondary),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '$sessions AI sessions active',
                      style: const TextStyle(fontWeight: FontWeight.w500),
                    ),
                    const Text(
                      'Sessions are shared across your devices',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInfoSection(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'ABOUT BRIDGE',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary,
          ),
        ),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.surfaceDark,
            borderRadius: BorderRadius.circular(12),
          ),
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Bridge is a desktop service that connects your AI sessions to the OpenChat network.',
                style: TextStyle(color: AppColors.textSecondary, height: 1.5),
              ),
              SizedBox(height: 16),
              Text(
                'To install Bridge:',
                style: TextStyle(fontWeight: FontWeight.w500),
              ),
              SizedBox(height: 8),
              Text(
                'npm install -g openchat-bridge',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: AppColors.primary,
                ),
              ),
              SizedBox(height: 4),
              Text(
                'openchat-bridge start',
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
