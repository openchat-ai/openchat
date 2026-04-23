import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/providers/agent_provider.dart';
import 'package:openchat_flutter/ui/widgets/agent_task_card.dart';

class AgentHubScreen extends ConsumerWidget {
  const AgentHubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final agentsAsync = ref.watch(agentProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('AI Agent Hub'),
        centerTitle: true,
        elevation: 0,
        backgroundColor: Colors.transparent,
        foregroundColor: Colors.black,
      ),
      body: agentsAsync.when(
        data: (agents) {
          if (agents.isEmpty) {
            return _buildEmptyState(context, ref);
          }
          return ListView.builder(
            padding: const EdgeInsets.only(bottom: 80),
            itemCount: agents.length,
            itemBuilder: (context, index) => AgentTaskCard(agent: agents[index]),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(child: Text('Error: $err')),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showCreateAgentDialog(context, ref),
        label: const Text('Deploy New Agent'),
        icon: const Icon(Icons.add),
        backgroundColor: Colors.blueAccent,
      ),
    );
  }

  Widget _buildEmptyState(BuildContext context, WidgetRef ref) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.psychology_outlined, size: 80, color: Colors.grey[400]),
          const SizedBox(height: 16),
          Text('No active agents in this Bridge', 
               style: TextStyle(color: Colors.grey[600], fontSize: 16)),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: () => _showCreateAgentDialog(context, ref),
            child: const Text('Deploy First Expert'),
          ),
        ],
      ),
    );
  }

  void _showCreateAgentDialog(BuildContext context, WidgetRef ref) {
    final nameController = TextEditingController();
    final taskController = TextEditingController();
    String selectedRole = 'custom';

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Deploy Expert Agent'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'Agent Name'),
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: selectedRole,
                decoration: const InputDecoration(labelText: 'Specialization (Role)'),
                items: ['custom', 'security_auditor', 'code_quality_analyzer', 'performance_analyzer', 'test_engineer']
                    .map((role) => DropdownMenuItem(value: role, child: Text(role)))
                    .toList(),
                onChanged: (val) => selectedRole = val!,
              ),
              const SizedBox(height: 16),
              TextField(
                controller: taskController,
                decoration: const InputDecoration(labelText: 'Specific Task / Instruction'),
                maxLines: 3,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          ElevatedButton(
            onPressed: () async {
              await ref.read(agentProvider.notifier).spawnAgent(
                role: selectedRole,
                name: nameController.text,
                task: taskController.text,
              );
              if (context.mounted) Navigator.pop(context);
            },
            child: const Text('Deploy'),
          ),
        ],
      ),
    );
  }
}
