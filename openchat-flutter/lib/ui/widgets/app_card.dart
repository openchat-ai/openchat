import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';

enum CardVariant {
  filled,
  outlined,
  elevated,
  gradient,
  glass,
}

class AppCard extends ConsumerWidget {
  final Widget child;
  final CardVariant variant;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final double? width;
  final double? height;
  final BorderRadius? borderRadius;
  final List<Color>? gradientColors;
  final bool isSelected;

  const AppCard({
    super.key,
    required this.child,
    this.variant = CardVariant.filled,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
    this.width,
    this.height,
    this.borderRadius,
    this.gradientColors,
    this.isSelected = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    Widget card = Container(
      width: width,
      height: height,
      padding: padding,
      decoration: _buildDecoration(theme),
      child: child,
    );
    if (onTap != null) {
      card = GestureDetector(
        onTap: onTap,
        child: AnimatedScale(
          scale: 1.0,
          duration: const Duration(milliseconds: 150),
          child: card,
        ),
      );
    }
    return card;
  }

  BoxDecoration _buildDecoration(AppTheme theme) {
    final radius = borderRadius ?? BorderRadius.circular(theme.radiusMedium);
    switch (variant) {
      case CardVariant.filled:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: radius,
          border: Border.all(
            color: isSelected
              ? theme.primary.withValues(alpha: 0.5)
              : theme.textTertiary.withValues(alpha: 0.1),
            width: isSelected ? 2 : 1,
          ),
        );
      case CardVariant.outlined:
        return BoxDecoration(
          color: Colors.transparent,
          borderRadius: radius,
          border: Border.all(
            color: isSelected
              ? theme.primary
              : theme.textTertiary.withValues(alpha: 0.2),
            width: isSelected ? 2 : 1,
          ),
        );
      case CardVariant.elevated:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.8),
          borderRadius: radius,
          boxShadow: theme.shadows,
        );
      case CardVariant.gradient:
        return BoxDecoration(
          gradient: LinearGradient(
            colors: gradientColors ?? theme.gradientPrimary,
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: radius,
          boxShadow: theme.useGlow ? [
            BoxShadow(
              color: (gradientColors ?? theme.gradientPrimary)[0].withValues(alpha: 0.4),
              blurRadius: 20,
              spreadRadius: 2,
            ),
          ] : null,
        );
      case CardVariant.glass:
        return BoxDecoration(
          color: theme.surface.withValues(alpha: 0.3),
          borderRadius: radius,
          border: Border.all(color: Colors.white.withValues(alpha: 0.1), width: 1),
        );
    }
  }
}
