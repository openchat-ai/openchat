import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class TaskStatusSection extends StatelessWidget {
  final Map<String, dynamic> layout;
  final AppTheme theme;
  const TaskStatusSection({super.key, required this.layout, required this.theme});

  @override
  Widget build(BuildContext context) {
    final label = layout['statusLabel'] as String? ?? 'Status';
    final rawItems = layout['statusItems'] as List?;
    final items = rawItems?.map((e) {
      if (e is! Map) return <String, String>{};
      return {
        'label': e['label'] as String? ?? '',
        'status': e['status'] as String? ?? '',
        'color': _statusColor(e['status'] as String? ?? ''),
      };
    }).toList() ?? const [
      {'label': 'Analyze code', 'status': 'Completed', 'color': '#4CAF50'},
      {'label': 'Scan vulns', 'status': 'Completed', 'color': '#4CAF50'},
      {'label': 'Performance', 'status': 'In Progress', 'color': '#FF9800'},
      {'label': 'Generate report', 'status': 'Pending', 'color': '#9E9E9E'},
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
              _StatusItem(item: items[i], theme: theme),
            ],
          ],
        ),
      ),
    ]);
  }

  static String _statusColor(String status) {
    if (status == 'Completed') return '#4CAF50';
    if (status == 'In Progress') return '#FF9800';
    return '#9E9E9E';
  }
}

class _StatusItem extends StatelessWidget {
  final Map<String, String> item;
  final AppTheme theme;
  const _StatusItem({required this.item, required this.theme});

  @override
  Widget build(BuildContext context) {
    final isCompleted = item['status'] == 'Completed';
    final color = _hexOr(item['color'], isCompleted ? theme.success : theme.textTertiary);
    return Row(children: [
      Container(
        width: 24, height: 24,
        decoration: BoxDecoration(
          color: isCompleted ? color : Colors.transparent,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isCompleted ? color : theme.textTertiary, width: 2),
        ),
        child: isCompleted ? const Icon(Icons.check, color: Colors.white, size: 16) : null,
      ),
      const SizedBox(width: 12),
      Expanded(child: Text(item['label'] ?? '', style: TextStyle(color: theme.textPrimary, fontSize: 14))),
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(8)),
        child: Text(item['status'] ?? '', style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w500)),
      ),
    ]);
  }
}

Color _hexOr(String? hex, Color fallback) {
  if (hex == null) return fallback;
  try { return Color(int.parse(hex.replaceAll('#', '0xFF'))); } catch (_) { return fallback; }
}
