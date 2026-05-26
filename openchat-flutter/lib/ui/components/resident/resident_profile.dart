import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';
import '../../../core/models/resident_model.dart';

class ResidentProfile extends StatelessWidget {
  final AppTheme theme;
  final Resident resident;
  const ResidentProfile({super.key, required this.theme, required this.resident});

  @override
  Widget build(BuildContext context) {
    final days = DateTime.now().difference(resident.createdAt).inDays;
    final tags = resident.traitLabels;
    return SliverToBoxAdapter(child: Container(
      margin: const EdgeInsets.all(20), padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(theme.radiusLarge),
        border: Border.all(color: resident.isActive ? theme.gradientPrimary[0].withValues(alpha: 0.3) : theme.textTertiary.withValues(alpha: 0.08))),
      child: Column(children: [
        Container(width: 80, height: 80,
          decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary), borderRadius: BorderRadius.circular(20),
            boxShadow: theme.useGlow ? [BoxShadow(color: theme.primary.withValues(alpha: 0.3), blurRadius: 20, spreadRadius: 2)] : null),
          child: Center(child: Text(resident.name.isNotEmpty ? resident.name[0] : '?', style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)))),
        const SizedBox(height: 16),
        Text(resident.name, style: TextStyle(color: theme.textPrimary, fontSize: 22, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          _chip('ID: ${resident.id}', theme.textTertiary), const SizedBox(width: 8),
          _chip(resident.home, theme.gradientPrimary[0]),
          if (!resident.isActive) ...[const SizedBox(width: 8), _chip('已注销', theme.textTertiary)],
        ]),
        const SizedBox(height: 6),
        Text('出生 ${resident.createdAt.toLocal().toString().substring(0, 10)} · 已存活 $days 天', style: TextStyle(color: theme.textTertiary, fontSize: 13)),
        if (tags.isNotEmpty) ...[const SizedBox(height: 14),
          Wrap(spacing: 6, runSpacing: 6, children: tags.map((t) => Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
            decoration: BoxDecoration(gradient: LinearGradient(colors: [theme.primary.withValues(alpha: 0.2), theme.gradientPrimary[0].withValues(alpha: 0.1)]), borderRadius: BorderRadius.circular(20), border: Border.all(color: theme.primary.withValues(alpha: 0.2))),
            child: Text(t, style: TextStyle(color: theme.primary, fontSize: 12, fontWeight: FontWeight.w500)))).toList()),
        ],
      ]),
    ));
  }

  Widget _chip(String text, Color color) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
    decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(8)),
    child: Text(text, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w500)));
}
