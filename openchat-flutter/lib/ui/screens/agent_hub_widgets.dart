import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import '../../core/models/resident_model.dart';
import '../../core/sdui.dart';
import 'package:sdui_engine/sdui_engine.dart' show SduiParser;

class AgentHubWidgets {
  static Widget buildEmptyState(AppTheme theme, Map? state) {
    if (state == null) {
      return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.person_outline, color: theme.textTertiary, size: 64),
        const SizedBox(height: 16),
        Text('杩樻没鏈?AI 灞呮皯', style: TextStyle(color: theme.textSecondary, fontSize: 16)),
      ]));
    }
    final parser = SduiParser(vars: {}, onAction: null);
    final node = {
      'type': 'column', 'center': true, 'children': [
        {'type': 'padding', 'padding': 32, 'child': {'type': 'icon', 'icon': state['icon'] ?? 'person', 'size': 64}},
        if (state['title'] != null) {'type': 'text', 'content': state['title'], 'style': {'size': 16}, 'pad': 8},
        if (state['subtitle'] != null) {'type': 'text', 'content': state['subtitle'], 'style': {'size': 13, 'color': '#9E9E9E'}},
      ],
    };
    return Center(child: parser.parse(node));
  }

  static Widget buildActionButton(IconData icon, AppTheme theme, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(right: 8), padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
          border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1), width: 1)),
        child: Icon(icon, color: theme.textSecondary, size: 20),
      ),
    );
  }
}

class ResidentFallbackList extends StatelessWidget {
  final AppTheme theme;
  final List<Resident> residents;
  final Widget emptyState;

  const ResidentFallbackList({
    super.key,
    required this.theme,
    required this.residents,
    required this.emptyState,
  });

  @override
  Widget build(BuildContext context) {
    if (residents.isEmpty) return emptyState;
    return ListView(padding: const EdgeInsets.all(16), children: residents.map((r) {
      final isActive = r.isActive;
      return Container(
        margin: const EdgeInsets.only(bottom: 16), padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusLarge),
          border: Border.all(color: isActive ? theme.gradientPrimary[0].withValues(alpha: 0.4)
            : theme.textTertiary.withValues(alpha: 0.08), width: 1)),
        child: Row(children: [
          Text(r.name.isNotEmpty ? r.name[0] : '?',
            style: TextStyle(color: theme.textPrimary, fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(width: 16),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(r.name, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
            Text('ID: ${r.id} 路 ${r.home}', style: TextStyle(color: theme.textTertiary, fontSize: 12)),
          ])),
        ]),
      );
    }).toList());
  }
}
