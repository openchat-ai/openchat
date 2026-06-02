import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../providers/theme_provider.dart';

class GroupedList<T> extends ConsumerWidget {
  final List<T> items;
  final String Function(T) groupBy;
  final Widget Function(T) itemBuilder;
  final Widget Function(String)? groupHeaderBuilder;
  final EdgeInsets padding;

  const GroupedList({
    super.key,
    required this.items,
    required this.groupBy,
    required this.itemBuilder,
    this.groupHeaderBuilder,
    this.padding = const EdgeInsets.symmetric(horizontal: 16),
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(currentThemeProvider);
    final groups = <String, List<T>>{};
    for (final item in items) {
      final key = groupBy(item);
      groups.putIfAbsent(key, () => []).add(item);
    }
    return ListView.builder(
      padding: padding,
      itemCount: groups.length,
      itemBuilder: (context, index) {
        final groupKey = groups.keys.elementAt(index);
        final groupItems = groups[groupKey]!;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            groupHeaderBuilder?.call(groupKey) ??
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 20, 4, 8),
              child: Text(
                groupKey.toUpperCase(),
                style: TextStyle(
                  color: theme.textTertiary,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 2,
                ),
              ),
            ),
            ...groupItems.map((item) => itemBuilder(item)),
          ],
        );
      },
    );
  }
}
