import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';
import '../../../core/models/agent_model.dart';

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
