import 'package:flutter/material.dart';
import '../../core/theme/app_theme.dart';

class TaskActionRow extends StatelessWidget {
  final Map<String, dynamic> layout;
  final AppTheme theme;
  const TaskActionRow({super.key, required this.layout, required this.theme});

  @override
  Widget build(BuildContext context) {
    final rawActions = layout['actions'] as List?;
    final actions = rawActions?.map((e) {
      if (e is! Map) return <String, String>{};
      return {
        'label': e['label'] as String? ?? '',
        'color': e['color'] as String? ?? '',
        'primary': (e['primary'] == true).toString(),
      };
    }).toList() ?? const [
      {'label': '鏆傚仠浠诲姟', 'color': '', 'primary': 'false'},
      {'label': '鏌ョ湅鎶ュ憡', 'color': '', 'primary': 'true'},
    ];

    return Row(children: [
      for (var i = 0; i < actions.length; i++) ...[
        if (i > 0) const SizedBox(width: 12),
        Expanded(child: _ActionButton(item: actions[i], theme: theme)),
      ],
    ]);
  }
}

class _ActionButton extends StatelessWidget {
  final Map<String, String> item;
  final AppTheme theme;
  const _ActionButton({required this.item, required this.theme});

  @override
  Widget build(BuildContext context) {
    final isPrimary = item['primary'] == 'true';
    return GestureDetector(
      onTap: () {},
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          gradient: isPrimary ? LinearGradient(colors: theme.gradientPrimary) : null,
          color: isPrimary ? null : theme.surface.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(theme.radiusMedium),
          border: isPrimary ? null : Border.all(color: theme.textTertiary.withValues(alpha: 0.2), width: 1),
        ),
        child: Center(
          child: Text(
            item['label'] ?? '',
            style: TextStyle(
              color: isPrimary ? Colors.white : theme.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
    );
  }
}
