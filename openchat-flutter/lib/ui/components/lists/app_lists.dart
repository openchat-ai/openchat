import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../providers/theme_provider.dart';

/// 分组列表
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
    
    // 按组分类
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
            // 分组标题
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
            // 分组内容
            ...groupItems.map((item) => itemBuilder(item)),
          ],
        );
      },
    );
  }
}

/// 可展开列表项
class ExpandableListItem extends ConsumerStatefulWidget {
  final Widget header;
  final Widget content;
  final bool initiallyExpanded;

  const ExpandableListItem({
    super.key,
    required this.header,
    required this.content,
    this.initiallyExpanded = false,
  });

  @override
  ConsumerState<ExpandableListItem> createState() => _ExpandableListItemState();
}

class _ExpandableListItemState extends ConsumerState<ExpandableListItem>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  bool _isExpanded = false;

  @override
  void initState() {
    super.initState();
    _isExpanded = widget.initiallyExpanded;
    _controller = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    _animation = CurvedAnimation(
      parent: _controller,
      curve: Curves.easeInOut,
    );
    if (_isExpanded) {
      _controller.value = 1.0;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _toggle() {
    setState(() {
      _isExpanded = !_isExpanded;
      if (_isExpanded) {
        _controller.forward();
      } else {
        _controller.reverse();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusMedium),
        border: Border.all(
          color: theme.textTertiary.withValues(alpha: 0.1),
          width: 1,
        ),
      ),
      child: Column(
        children: [
          GestureDetector(
            onTap: _toggle,
            child: Container(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(child: widget.header),
                  AnimatedRotation(
                    turns: _isExpanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 300),
                    child: Icon(
                      Icons.expand_more,
                      color: theme.textTertiary,
                    ),
                  ),
                ],
              ),
            ),
          ),
          SizeTransition(
            sizeFactor: _animation,
            child: Container(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: widget.content,
            ),
          ),
        ],
      ),
    );
  }
}

/// 滑动操作列表项
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
      child: GestureDetector(
        onTap: onTap,
        child: child,
      ),
    );
  }
}

/// 滑动操作配置
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

/// 时间线列表
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
            // 时间线
            Column(
              children: [
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: theme.primary,
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: theme.background,
                      width: 2,
                    ),
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
            // 内容
            Expanded(
              child: itemBuilder(displayItems[index], index),
            ),
          ],
        );
      },
    );
  }
}

/// 加载更多列表
class LoadMoreList extends ConsumerStatefulWidget {
  final List<Widget> items;
  final Future<void> Function() onLoadMore;
  final bool hasMore;
  final EdgeInsets padding;

  const LoadMoreList({
    super.key,
    required this.items,
    required this.onLoadMore,
    required this.hasMore,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  ConsumerState<LoadMoreList> createState() => _LoadMoreListState();
}

class _LoadMoreListState extends ConsumerState<LoadMoreList> {
  final ScrollController _controller = ScrollController();
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_onScroll);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_controller.position.pixels >=
        _controller.position.maxScrollExtent - 200) {
      _loadMore();
    }
  }

  Future<void> _loadMore() async {
    if (_isLoading || !widget.hasMore) return;
    
    setState(() => _isLoading = true);
    await widget.onLoadMore();
    setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    final theme = ref.watch(currentThemeProvider);

    return ListView(
      controller: _controller,
      padding: widget.padding,
      children: [
        ...widget.items,
        if (_isLoading)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Center(
              child: CircularProgressIndicator(
                color: theme.primary,
              ),
            ),
          ),
        if (!widget.hasMore && widget.items.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Center(
              child: Text(
                '已经到底了',
                style: TextStyle(
                  color: theme.textTertiary,
                  fontSize: 12,
                ),
              ),
            ),
          ),
      ],
    );
  }
}
