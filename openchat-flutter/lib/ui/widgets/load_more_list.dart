import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../providers/client_providers.dart';

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
            child: Center(child: CircularProgressIndicator(color: theme.primary)),
          ),
        if (!widget.hasMore && widget.items.isNotEmpty)
          Padding(
            padding: const EdgeInsets.all(16),
            child: Center(
              child: Text('已经到底了',
                style: TextStyle(color: theme.textTertiary, fontSize: 12)),
            ),
          ),
      ],
    );
  }
}
