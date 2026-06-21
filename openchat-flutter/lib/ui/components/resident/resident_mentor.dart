import 'package:flutter/material.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/models/resident_model.dart';

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
          label: const Text('Wisdom'),
          style: ElevatedButton.styleFrom(backgroundColor: Colors.amberAccent.withValues(alpha: 0.2), foregroundColor: Colors.amberAccent, padding: const EdgeInsets.symmetric(vertical: 12), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
        ))),
      if (conversations.isEmpty)
        Padding(padding: const EdgeInsets.all(32), child: Text('No conversations', style: TextStyle(color: theme.textTertiary, fontSize: 14)))
      else
        ...conversations.map((r) => Padding(padding: const EdgeInsets.only(bottom: 12), child: _mentorCard(r))),
    ]));
  }

  Widget _mentorCard(SageRecord record) {
    final isQuestion = record.type == 'ask';
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
          Text(isQuestion ? 'Question' : 'Wisdom', style: TextStyle(color: isQuestion ? theme.primary : Colors.amberAccent, fontSize: 12, fontWeight: FontWeight.w600)),
          const Spacer(),
          Text(record.createdAt.toLocal().toString().substring(0, 10), style: TextStyle(color: theme.textTertiary, fontSize: 10)),
        ]),
        const SizedBox(height: 8),
        Text(record.content, style: TextStyle(color: theme.textPrimary, fontSize: 13, height: 1.4)),
        if (!isQuestion && onReply != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: Align(alignment: Alignment.centerRight, child: TextButton.icon(
            onPressed: () => onReply!(record),
            icon: const Icon(Icons.reply, size: 14),
            label: const Text('Reply', style: TextStyle(fontSize: 12)),
          ))),
      ]));
  }
}
