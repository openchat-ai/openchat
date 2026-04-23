import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/core/models/agent_model.dart';
import 'package:openchat_flutter/providers/agent_provider.dart';

class AgentTaskCard extends ConsumerWidget {
  final Agent agent;

  const AgentTaskCard({super.key, required this.agent});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final statusColor = _getStatusColor(agent.status);
    
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding: const EdgeInsets.all(16),
        title: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              agent.name,
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
            ),
            _buildStatusBadge(agent.status, statusColor),
          ],
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 8),
            Text(
              "Role: ${agent.role}",
              style: TextStyle(color: Colors.grey[600], fontSize: 13),
            ),
            if (agent.task != null) ...[
              const SizedBox(height: 4),
              Text(
                agent.task!,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14),
              ),
            ],
          ],
        ),
        trailing: IconButton(
          icon: const Icon(Icons.chevron_right),
          onPressed: () => _navigateToDetail(context, agent.id),
        ),
      ),
    );
  }

  Widget _buildStatusBadge(AgentStatus status, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color, width: 1),
      ),
      child: Text(
        status.name.toUpperCase(),
        style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold),
      ),
    );
  }

  Color _getStatusColor(AgentStatus status) {
    switch (status) {
      case AgentStatus.initializing: return Colors.blue;
      case AgentStatus.running: return Colors.orange;
      case AgentStatus.completed: return Colors.green;
      case AgentStatus.failed: return Colors.red;
      case AgentStatus.terminated: return Colors.grey;
    }
  }

  void _navigateToDetail(BuildContext context, String agentId) {
    // 这里的路由将在 screens 中定义
    Navigator.pushNamed(context, '/agent-detail', arguments: agentId);
  }
}
