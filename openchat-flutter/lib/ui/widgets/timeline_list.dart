import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../providers/theme_provider.dart';

class TimelineList<T> extends ConsumerWidget {
  final List<T> items;
  final Widget Function(T, int) itemBuilder;
  final bool isReversed;

  const TimelineList({
    super.key,
    required this.items,
    required this.itemBuilder,
    this.isReversed = false,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    final displayItems = isReversed ? items.reversed.toList() : items;
    return ListView.builder(
      itemCount: displayItems.length,
      itemBuilder: (context, index) {
        final isLast = index == displayItems.length - 1;
        return Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Column(
              children: [
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: theme.primary,
                    shape: BoxShape.circle,
                    border: Border.all(color: theme.background, width: 2),
                  ),
                ),
                if (!isLast)
                  Container(
                    width: 2,
                    height: 50,
                    color: theme.textTertiary.withValues(alpha: 0.2),
                  ),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(child: itemBuilder(displayItems[index], index)),
          ],
        );
      },
    );
  }
}
