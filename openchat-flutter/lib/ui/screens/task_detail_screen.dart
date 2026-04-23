import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/core/models/agent_model.dart';
import 'package:openchat_flutter/providers/agent_provider.dart';

class TaskDetailScreen extends ConsumerStatefulWidget {
  final String agentId;

  const TaskDetailScreen({super.key, required this.agentId});

  @override
  ConsumerState<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends ConsumerState<TaskDetailScreen> {
  late Future<AgentFeedback> _feedbackFuture;

  @override
  void initState() {
    super.initState();
    // 初始加载 Agent 的反馈结果
    _feedbackFuture = ref.read(agentClientProvider).getAgentFeedback(widget.agentId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Task Analysis'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: () async {
              await ref.read(agentProvider.notifier).stopAgent(widget.agentId);
              if (context.mounted) Navigator.pop(context);
            },
          ),
        ],
      ),
      body: FutureBuilder<AgentFeedback>(
        future: _feedbackFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          } else if (snapshot.hasError) {
            return Center(child: Text('Error loading feedback: ${snapshot.error}'));
          } else if (!snapshot.hasData) {
            return const Center(child: Text('No feedback available yet'));
          }

          final feedback = snapshot.data!;
          return SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildSummarySection(feedback),
                const SizedBox(height: 24),
                const Text(
                  'Detailed Findings',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 12),
                ...feedback.findings.map((f) => _buildFindingCard(f)).toList(),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _buildSummarySection(AgentFeedback feedback) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.blueAccent.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.blueAccent),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('AI Summary', style: TextStyle(fontWeight: FontWeight.bold)),
              Text('Score: ${feedback.performanceScore}', 
                   style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.blueAccent)),
            ],
          ),
          const SizedBox(height: 8),
          Text(feedback.summary, style: const TextStyle(fontSize: 15)),
        ],
      ),
    );
  }

  Widget _buildFindingCard(Finding finding) {
    Color severityColor = _getSeverityColor(finding.type);
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: severityColor, borderRadius: BorderRadius.circular(4)),
                  child: Text(finding.type, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
                ),
                const SizedBox(width: 8),
                Text('Confidence: ${(finding.confidence * 100).toInt()}%', 
                     style: const TextStyle(fontSize: 12, color: Colors.grey)),
              ],
            ),
            const SizedBox(height: 8),
            Text(finding.description, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
            const SizedBox(height: 8),
            Text('Location: ${finding.location}', style: const TextStyle(fontSize: 13, color: Colors.grey)),
            const Divider(),
            const Text('Remediation:', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
            Text(finding.remediation, style: const TextStyle(fontSize: 13)),
          ],
        ),
      ),
    );
  }

  Color _getSeverityColor(String type) {
    switch (type.toUpperCase()) {
      case 'CRITICAL': return Colors.red;
      case 'HIGH': return Colors.orange;
      case 'MEDIUM': return Colors.yellow[700]!;
      case 'LOW': return Colors.green;
      default: return Colors.grey;
    }
  }
}
