import 'dart:math';
import 'package:flutter/material.dart';
import '../../../core/audio/audio.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/models/agent_model.dart';
import '../../../core/models/resident_model.dart';

// ===== resident_profile.dart =====
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
          if (!resident.isActive) ...[const SizedBox(width: 8), _chip('Offline', theme.textTertiary)],
        ]),
        const SizedBox(height: 6),
        Text('Created ${resident.createdAt.toLocal().toString().substring(0, 10)} · ${days}d', style: TextStyle(color: theme.textTertiary, fontSize: 13)),
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

// ===== resident_family.dart =====
class ResidentFamily extends StatelessWidget {
  final AppTheme theme;
  final Resident resident;
  final List<Resident> children;
  const ResidentFamily({super.key, required this.theme, required this.resident, required this.children});

  @override
  Widget build(BuildContext context) {
    return SliverToBoxAdapter(child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('家庭关系', style: TextStyle(color: theme.textPrimary, fontSize: 18, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        if (resident.parentId != null) _relationCard('Parent', resident.parentId.toString(), Icons.account_tree_outlined),
        if (children.isNotEmpty) ...[
          const SizedBox(height: 8), Text('Children (${children.length})', style: TextStyle(color: theme.textSecondary, fontSize: 13)), const SizedBox(height: 8),
          ...children.map((c) => Padding(padding: const EdgeInsets.only(bottom: 8), child: _childTile(c))),
        ],
        if (resident.parentId == null && children.isEmpty)
          Padding(padding: const EdgeInsets.all(16), child: Text('No family', style: TextStyle(color: theme.textTertiary, fontSize: 13))),
      ]),
    ));
  }

  Widget _relationCard(String label, String value, IconData icon) => Container(
    margin: const EdgeInsets.only(bottom: 8), padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12)),
    child: Row(children: [
      Icon(icon, color: theme.warning, size: 20), const SizedBox(width: 12),
      Text('$label: ', style: TextStyle(color: theme.textSecondary, fontSize: 13)),
      Text(value, style: TextStyle(color: theme.textPrimary, fontSize: 13, fontWeight: FontWeight.w500)),
    ]));

  Widget _childTile(Resident child) => Container(padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12), border: Border.all(color: theme.textTertiary.withValues(alpha: 0.08))),
    child: Row(children: [
      Container(width: 40, height: 40, decoration: BoxDecoration(gradient: LinearGradient(colors: theme.gradientPrimary), borderRadius: BorderRadius.circular(10)),
        child: Center(child: Text(child.name.isNotEmpty ? child.name[0] : '?', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)))),
      const SizedBox(width: 12),
      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(child.name, style: TextStyle(color: theme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
        Text('ID: ${child.id} · ${child.home}', style: TextStyle(color: theme.textTertiary, fontSize: 11)),
      ])),
    ]));
}

// ===== resident_agents.dart =====
class ResidentAgents extends StatelessWidget {
  final AppTheme theme;
  final List<Agent> agents;
  final void Function(String residentId)? onOpenDetail;
  const ResidentAgents({super.key, required this.theme, required this.agents, this.onOpenDetail});

  @override
  Widget build(BuildContext context) {
    final active = agents.where((a) => a.status == 'running').toList();
    return SliverToBoxAdapter(child: Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('活跃 Agent (${active.length})', style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        if (active.isEmpty)
          Padding(padding: const EdgeInsets.all(16), child: Text('暂无活跃 Agent', style: TextStyle(color: theme.textTertiary, fontSize: 13)))
        else
          ...active.map((a) => Padding(padding: const EdgeInsets.only(bottom: 8), child: _agentTile(a))),
      ]),
    ));
  }

  Widget _agentTile(Agent agent) {
    final isRunning = agent.status == 'running';
    return Container(padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12),
        border: Border.all(color: isRunning ? theme.success.withValues(alpha: 0.3) : theme.textTertiary.withValues(alpha: 0.08))),
      child: Row(children: [
        Container(width: 24, height: 24,
          decoration: BoxDecoration(color: isRunning ? theme.success : theme.textTertiary, borderRadius: BorderRadius.circular(8)),
          child: Icon(isRunning ? Icons.play_arrow : Icons.stop, color: Colors.white, size: 16)),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(agent.name, style: TextStyle(color: theme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
          Text(agent.role, style: TextStyle(color: theme.textTertiary, fontSize: 11)),
        ])),
        Icon(Icons.chevron_right, color: theme.textTertiary, size: 20),
      ]));
  }
}

// ===== resident_timeline.dart =====
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
        Text('活动记录', style: TextStyle(color: theme.textPrimary, fontSize: 16, fontWeight: FontWeight.w600)),
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

// ===== resident_mentor.dart =====
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

// ===== resident_music_score.dart =====
class ResidentMusicScore extends StatefulWidget {
  final String title;
  final List<ScoreNote> notes;
  final double bpm;
  const ResidentMusicScore({super.key, required this.title, required this.notes, this.bpm = 120});
  @override State<ResidentMusicScore> createState() => _ResidentMusicScoreState();
}

class _ResidentMusicScoreState extends State<ResidentMusicScore> with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  bool _playing = false;

  @override
  void initState() { super.initState(); _ctrl = AnimationController(vsync: this, duration: const Duration(seconds: 4)); _ctrl.addListener(() => setState(() {})); }
  @override void dispose() { _ctrl.dispose(); super.dispose(); }

  void _toggle() { if (_playing) _ctrl.stop(); else _ctrl.forward(from: _ctrl.value); setState(() => _playing = !_playing); }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      height: 260,
      child: Column(children: [
        Padding(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8), child: Row(children: [
          Text(widget.title, style: theme.textTheme.titleSmall), const Spacer(),
          IconButton(icon: Icon(_playing ? Icons.stop_rounded : Icons.play_arrow_rounded, size: 28), onPressed: _toggle),
        ])),
        Expanded(child: LayoutBuilder(builder: (context, cons) {
          final totalSec = widget.notes.isEmpty ? 4.0 : widget.notes.map((n) => n.startSec + n.durSec).reduce(max).clamp(4.0, 3600.0);
          return CustomPaint(size: Size(cons.maxWidth, cons.maxHeight), painter: _StaffPainter(notes: widget.notes, totalSec: totalSec, progress: _ctrl.value));
        })),
      ]),
    );
  }
}

class _StaffPainter extends CustomPainter {
  final List<ScoreNote> notes;
  final double totalSec;
  final double progress;
  _StaffPainter({required this.notes, required this.totalSec, required this.progress});

  @override
  void paint(Canvas c, Size s) {
    final h = s.height, w = s.width;
    const marginT = 16.0, marginB = 24.0;
    final staffH = h - marginT - marginB;
    final lineGap = staffH / 8;
    final staffTop = marginT;
    final staffBot = marginT + lineGap * 4;
    final lineP = Paint()..color = Colors.grey[700]!..strokeWidth = 1;
    for (int i = 0; i < 5; i++) c.drawLine(Offset(0, staffTop + i * lineGap), Offset(w, staffTop + i * lineGap), lineP);
    final now = progress * totalSec;
    final scrollW = (w - 40).clamp(200.0, 2000.0);
    final scrollOff = now / totalSec * scrollW;
    const refMidi = 64;
    final dotR = lineGap * 0.35;
    for (final note in notes) {
      final nx = w - 20 - ((note.startSec / totalSec) * scrollW - scrollOff);
      if (nx < -40 || nx > w + 40) continue;
      final nw = (note.durSec / totalSec) * scrollW;
      final staffPos = (note.midi - refMidi) / 2.0;
      final ny = staffBot - staffPos * lineGap;
      final played = note.startSec + note.durSec <= now;
      c.drawOval(Rect.fromCenter(center: Offset(nx, ny), width: nw.clamp(6, nw), height: dotR * 2), Paint()..color = played ? Colors.grey : const Color(0xFF4FC3F7));
      if (staffPos < 0) c.drawLine(Offset(nx - nw / 2 - 2, staffBot - (-1) * lineGap), Offset(nx + nw / 2 + 2, staffBot - (-1) * lineGap), lineP);
      if (staffPos == 0) c.drawLine(Offset(nx - nw / 2 - 2, staffBot - 0 * lineGap), Offset(nx + nw / 2 + 2, staffBot - 0 * lineGap), lineP);
      if (note.midi >= 72 && staffPos > 3.5) { for (double p = 4; p <= staffPos; p += 1) c.drawLine(Offset(nx - nw / 2 - 2, staffBot - p * lineGap), Offset(nx + nw / 2 + 2, staffBot - p * lineGap), lineP); }
      if (note.midi <= 60 && staffPos < -0.5) { for (double p = -1; p >= staffPos; p -= 1) c.drawLine(Offset(nx - nw / 2 - 2, staffBot - p * lineGap), Offset(nx + nw / 2 + 2, staffBot - p * lineGap), lineP); }
    }
    c.drawLine(Offset(w - 20 - scrollOff, marginT - 4), Offset(w - 20 - scrollOff, staffBot + 4), Paint()..color = Colors.orangeAccent..strokeWidth = 2);
  }

  @override
  bool shouldRepaint(_StaffPainter old) => old.progress != progress || old.notes != notes;
}
