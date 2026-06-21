import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/client_providers.dart';
import 'app_card.dart';

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
                    child: Image.network(imageUrl!, fit: BoxFit.cover),
                  )
                : Center(
                    child: Icon(Icons.image, color: theme.textTertiary, size: 40),
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
                    style: TextStyle(color: theme.textSecondary, fontSize: 12),
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
