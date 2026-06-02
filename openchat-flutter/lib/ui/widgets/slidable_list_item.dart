import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../providers/theme_provider.dart';

class SlidableAction {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const SlidableAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });
}

class SlidableListItem extends ConsumerWidget {
  final Widget child;
  final List<SlidableAction> actions;
  final VoidCallback? onTap;

  const SlidableListItem({
    super.key,
    required this.child,
    required this.actions,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    return Dismissible(
      key: UniqueKey(),
      background: Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: theme.success.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
        ),
        alignment: Alignment.centerLeft,
        padding: const EdgeInsets.only(left: 20),
        child: Icon(Icons.archive, color: theme.success),
      ),
      secondaryBackground: Container(
        margin: const EdgeInsets.only(bottom: 8),
        decoration: BoxDecoration(
          color: theme.error.withValues(alpha: 0.2),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
        ),
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        child: Icon(Icons.delete, color: theme.error),
      ),
      child: GestureDetector(onTap: onTap, child: child),
    );
  }
}
