import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_theme.dart';
import '../../../providers/theme_provider.dart';

/// Card variant types
enum CardVariant {
  filled,
  outlined,
  elevated,
  gradient,
  glass,
}

/// 统一卡片组件
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
          border: Border.all(
            color: Colors.white.withValues(alpha: 0.1),
            width: 1,
          ),
        );
    }
  }
}

/// List card item
class ListCard extends ConsumerWidget {
  final Widget? leading;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showDivider;
  final Color? leadingColor;

  const ListCard({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
    this.showDivider = false,
    this.leadingColor,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);

    return Column(
      children: [
        AppCard(
          variant: CardVariant.filled,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          onTap: onTap,
          child: Row(
            children: [
              if (leading != null) ...[
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [
                        (leadingColor ?? theme.gradientPrimary[0]).withValues(alpha: 0.2),
                        (leadingColor ?? theme.gradientPrimary[0]).withValues(alpha: 0.05),
                      ],
                    ),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(child: leading),
                ),
                const SizedBox(width: 14),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                        color: theme.textPrimary,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 4),
                      Text(
                        subtitle!,
                        style: TextStyle(
                          color: theme.textSecondary,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              ?trailing,
            ],
          ),
        ),
        if (showDivider)
          Divider(
            indent: 72,
            endIndent: 16,
            color: theme.textTertiary.withValues(alpha: 0.1),
            height: 1,
          ),
      ],
    );
  }
}

/// 统计卡片
class StatCard extends ConsumerWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color? color;
  final VoidCallback? onTap;

  const StatCard({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    this.color,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    final cardColor = color ?? theme.gradientPrimary[0];

    return AppCard(
      variant: CardVariant.filled,
      onTap: onTap,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  cardColor.withValues(alpha: 0.2),
                  cardColor.withValues(alpha: 0.05),
                ],
              ),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(icon, color: cardColor, size: 20),
          ),
          const Spacer(),
          Text(
            value,
            style: TextStyle(
              color: theme.textPrimary,
              fontSize: 28,
              fontWeight: FontWeight.bold,
              letterSpacing: -1,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              color: theme.textSecondary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

/// 图片卡片
class ImageCard extends ConsumerWidget {
  final String? imageUrl;
  final String title;
  final String? subtitle;
  final double aspectRatio;
  final VoidCallback? onTap;

  const ImageCard({
    super.key,
    this.imageUrl,
    required this.title,
    this.subtitle,
    this.aspectRatio = 16 / 9,
    this.onTap,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);

    return AppCard(
      variant: CardVariant.filled,
      padding: EdgeInsets.zero,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: aspectRatio,
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [
                    theme.gradientPrimary[0].withValues(alpha: 0.3),
                    theme.gradientPrimary[1].withValues(alpha: 0.1),
                  ],
                ),
                borderRadius: BorderRadius.vertical(
                  top: Radius.circular(theme.radiusMedium),
                ),
              ),
              child: imageUrl != null
                ? ClipRRect(
                    borderRadius: BorderRadius.vertical(
                      top: Radius.circular(theme.radiusMedium),
                    ),
                    child: Image.network(
                      imageUrl!,
                      fit: BoxFit.cover,
                    ),
                  )
                : Center(
                    child: Icon(
                      Icons.image,
                      color: theme.textTertiary,
                      size: 40,
                    ),
                  ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    color: theme.textPrimary,
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    subtitle!,
                    style: TextStyle(
                      color: theme.textSecondary,
                      fontSize: 12,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// 操作卡片
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
          Text(
            label,
            style: TextStyle(
              color: theme.textSecondary,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
