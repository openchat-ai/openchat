import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/theme_provider.dart';
import 'app_card.dart';

class ActionCard extends ConsumerWidget {
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Color? color;

  const ActionCard({
    super.key,
    required this.icon,
    required this.label,
    this.onTap,
    this.color,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    final actionColor = color ?? theme.gradientPrimary[0];
    return AppCard(
      variant: CardVariant.filled,
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  actionColor.withValues(alpha: 0.2),
                  actionColor.withValues(alpha: 0.05),
                ],
              ),
              borderRadius: BorderRadius.circular(14),
            ),
            child: Icon(icon, color: actionColor, size: 28),
          ),
          const SizedBox(height: 10),
          Text(label, style: TextStyle(color: theme.textSecondary, fontSize: 12)),
        ],
      ),
    );
  }
}
