import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class SettingsProfileHeader extends StatelessWidget {
  final AppTheme theme;
  const SettingsProfileHeader({super.key, required this.theme});

  @override
  Widget build(BuildContext context) {
    return SliverToBoxAdapter(
      child: Container(
        margin: const EdgeInsets.all(20), padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          gradient: LinearGradient(colors: [
            theme.gradientPrimary[0].withValues(alpha: 0.2),
            theme.gradientPrimary[1].withValues(alpha: 0.1),
          ]),
          borderRadius: BorderRadius.circular(theme.radiusLarge + 4),
          border: Border.all(color: theme.gradientPrimary[0].withValues(alpha: 0.3), width: 1),
        ),
        child: Row(children: [
          Container(
            width: 72, height: 72,
            decoration: BoxDecoration(
              gradient: LinearGradient(colors: theme.gradientPrimary),
              borderRadius: BorderRadius.circular(theme.radiusMedium),
            ),
            child: const Icon(Icons.person, color: Colors.white, size: 36),
          ),
          const SizedBox(width: 20),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Developer', style: TextStyle(color: theme.textPrimary, fontSize: 22, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text('ID: 88888888', style: TextStyle(color: theme.textTertiary, fontSize: 13)),
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary),
                borderRadius: BorderRadius.circular(10)),
              child: const Text('VIP', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            ),
          ])),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: theme.surface.withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(theme.radiusMedium - 4)),
            child: Icon(Icons.qr_code, color: theme.textPrimary, size: 22),
          ),
        ]),
      ),
    );
  }
}
