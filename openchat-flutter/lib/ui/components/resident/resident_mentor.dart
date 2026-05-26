import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';
import '../../../core/models/sage_model.dart';

class ResidentMentor extends StatelessWidget {
  final AppTheme theme;
  final List<SageRecord> conversations;
  final void Function(SageRecord record)? onReply;
  final VoidCallback? onAskWisdom;
  const ResidentMentor({super.key, required this.theme, required this.conversations, this.onReply, this.onAskWisdom});

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(padding: const EdgeInsets.all(16), child: Column(children: [
      if (onAskWisdom != null)
        Padding(padding: const EdgeInsets.only(bottom: 16), child: SizedBox(width: double.infinity, child: ElevatedButton.icon(
          onPressed: onAskWisdom,
          icon: const Icon(Icons.auto_awesome_outlined),
          label: const Text('智者点拨'),
          style: ElevatedButton.styleFrom(backgroundColor: Colors.amberAccent.withValues(alpha: 0.2), foregroundColor: Colors.amberAccent, padding: const EdgeInsets.symmetric(vertical: 12), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
        ))),
      if (conversations.isEmpty)
        Padding(padding: const EdgeInsets.all(32), child: Text('暂无对话记录', style: TextStyle(color: theme.textTertiary, fontSize: 14)))
      else
        ...conversations.map((r) => Padding(padding: const EdgeInsets.only(bottom: 12), child: _mentorCard(r))),
    ]));
  }

  Widget _mentorCard(SageRecord record) {
    final isQuestion = record.role == 'resident';
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: isQuestion ? theme.primary.withValues(alpha: 0.08) : theme.surface.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: isQuestion ? theme.primary.withValues(alpha: 0.2) : theme.textTertiary.withValues(alpha: 0.08))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(isQuestion ? Icons.person : Icons.auto_awesome, color: isQuestion ? theme.primary : Colors.amberAccent, size: 18),
          const SizedBox(width: 8),
          Text(isQuestion ? '提问' : '智者', style: TextStyle(color: isQuestion ? theme.primary : Colors.amberAccent, fontSize: 12, fontWeight: FontWeight.w600)),
          const Spacer(),
          Text(record.createdAt.toLocal().toString().substring(0, 10), style: TextStyle(color: theme.textTertiary, fontSize: 10)),
        ]),
        const SizedBox(height: 8),
        Text(record.content, style: TextStyle(color: theme.textPrimary, fontSize: 13, height: 1.4)),
        if (record.answer != null) ...[
          const SizedBox(height: 8),
          Container(padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: theme.background.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(10)),
            child: Text(record.answer!, style: TextStyle(color: theme.textSecondary, fontSize: 12, height: 1.4))),
        ],
        if (!isQuestion && onReply != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: Align(alignment: Alignment.centerRight, child: TextButton.icon(
            onPressed: () => onReply!(record),
            icon: const Icon(Icons.reply, size: 14),
            label: const Text('回复', style: TextStyle(fontSize: 12)),
          ))),
      ]));
  }
}
