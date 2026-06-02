import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class TaskInfoSection extends StatelessWidget {
  final Map<String, dynamic> layout;
  final AppTheme theme;
  const TaskInfoSection({super.key, required this.layout, required this.theme});

  @override
  Widget build(BuildContext context) {
    final label = layout['infoLabel'] as String? ?? '基本信息';
    final rawItems = layout['infoItems'] as List?;
    final items = rawItems?.map((e) {
      if (e is! Map) return <String>['', ''];
      return [e['label'] as String? ?? '', e['value'] as String? ?? ''];
    }).toList() ?? const [
      ['Executor', 'AI Agent'],
      ['Priority', 'High'],
      ['Time', '15 min'],
      ['Deadline', '2024-01-20'],
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
              if (i > 0) const SizedBox(height: 10),
              _InfoRow(label: items[i][0], value: items[i][1], theme: theme),
            ],
          ],
        ),
      ),
    ]);
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final AppTheme theme;
  const _InfoRow({required this.label, required this.value, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: theme.textSecondary, fontSize: 13)),
        Text(value, style: TextStyle(color: theme.textPrimary, fontSize: 13, fontWeight: FontWeight.w500)),
      ],
    );
  }
}
