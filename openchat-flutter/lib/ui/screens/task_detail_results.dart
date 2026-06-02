import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class TaskResultSection extends StatelessWidget {
  final Map<String, dynamic> layout;
  final AppTheme theme;
  const TaskResultSection({super.key, required this.layout, required this.theme});

  @override
  Widget build(BuildContext context) {
    final label = layout['resultLabel'] as String? ?? 'Results';
    final rawItems = layout['resultItems'] as List?;
    final items = rawItems?.map((e) {
      if (e is! Map) return <String, String>{};
      return {
        'label': e['label'] as String? ?? '',
        'value': e['value'] as String? ?? '',
        'color': e['color'] as String? ?? '#9E9E9E',
      };
    }).toList() ?? const [
      {'label': 'Issues', 'value': '3', 'color': '#F44336'},
      {'label': 'Warnings', 'value': '7', 'color': '#FF9800'},
      {'label': 'Suggestions', 'value': '12', 'color': '#2196F3'},
      {'label': '浠ｇ爜璐ㄩ噺璇勫垎', 'value': '85', 'color': '#4CAF50'},
    ];

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(label, style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
      const SizedBox(height: 12),
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
          border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1)),
        ),
        child: Column(
          children: [
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) const SizedBox(height: 12),
              _ResultRow(item: items[i], theme: theme),
            ],
          ],
        ),
      ),
    ]);
  }
}

class _ResultRow extends StatelessWidget {
  final Map<String, String> item;
  final AppTheme theme;
  const _ResultRow({required this.item, required this.theme});

  @override
  Widget build(BuildContext context) {
    final color = _hexOr(item['color'], theme.textTertiary);
    return Row(children: [
      Container(
        width: 8, height: 8,
        decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(4)),
      ),
      const SizedBox(width: 12),
      Expanded(child: Text(item['label'] ?? '', style: TextStyle(color: theme.textSecondary, fontSize: 13))),
      Text(item['value'] ?? '', style: TextStyle(color: color, fontSize: 16, fontWeight: FontWeight.bold)),
    ]);
  }
}

Color _hexOr(String? hex, Color fallback) {
  if (hex == null) return fallback;
  try { return Color(int.parse(hex.replaceAll('#', '0xFF'))); } catch (_) { return fallback; }
}
