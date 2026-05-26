import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/models/resident_model.dart';

class ResidentTimeline extends StatelessWidget {
  final AppTheme theme;
  final List<ResidentActivity> activities;
  const ResidentTimeline({super.key, required this.theme, required this.activities});

  @override
  Widget build(BuildContext context) {
    if (activities.isEmpty) return const SliverToBoxAdapter(child: SizedBox());
    return SliverToBoxAdapter(child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('娲诲姩璁板綍', style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        ...activities.map((a) => Padding(padding: const EdgeInsets.only(bottom: 8), child: _timelineItem(a))),
      ]),
    ));
  }

  Widget _timelineItem(ResidentActivity activity) {
    return Container(padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Container(width: 10, height: 10, margin: const EdgeInsets.only(top: 4),
          decoration: BoxDecoration(color: _activityColor(activity.type), borderRadius: BorderRadius.circular(5))),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(activity.message, style: TextStyle(color: theme.textPrimary, fontSize: 13)),
          const SizedBox(height: 4),
          Text(activity.timestamp.toLocal().toString().substring(0, 16), style: TextStyle(color: theme.textTertiary, fontSize: 11)),
        ])),
      ]));
  }

  Color _activityColor(String type) {
    switch (type) {
      case 'task_completed': return theme.success;
      case 'task_failed': return theme.error;
      case 'learning': return theme.info;
      case 'social': return theme.warning;
      default: return theme.textTertiary;
    }
  }
}
