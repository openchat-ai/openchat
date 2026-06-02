import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';
import 'package:sdui_engine/sdui_engine.dart' show SduiParser;

class ChatEmptyState extends StatelessWidget {
  final AppTheme theme;
  final Map<String, dynamic> layout;
  const ChatEmptyState({super.key, required this.theme, required this.layout});

  @override
  Widget build(BuildContext context) {
    final es = layout['emptyState'] as Map?;
    if (es == null) return const SizedBox();
    final parser = SduiParser(vars: {}, onAction: null);
    return Center(child: parser.parse({
      'type': 'column', 'center': true, 'children': [
        {'type': 'padding', 'padding': 32, 'child': {'type': 'icon', 'icon': es['icon'] ?? 'chat', 'size': 64}},
        if (es['title'] != null) {'type': 'text', 'content': es['title'], 'style': {'size': 16}, 'pad': 8},
        if (es['subtitle'] != null) {'type': 'text', 'content': es['subtitle'], 'style': {'size': 13, 'color': '#9E9E9E'}},
      ],
    }));
  }
}
