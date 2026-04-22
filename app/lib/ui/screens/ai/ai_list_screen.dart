import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/user_identity.dart';
import 'package:openchat/providers/ai_provider.dart';
import 'package:openchat/providers/contacts_provider.dart';
import 'package:openchat/ui/theme/colors.dart';
import 'package:openchat/ui/screens/profile/my_qr_screen.dart';

class AiListScreen extends ConsumerWidget {
  const AiListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final aiSessions = ref.watch(aiSessionsProvider);

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: const Text('AI Assistants'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => _showAddAiDialog(context, ref),
          ),
        ],
      ),
      body: aiSessions.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.smart_toy_outlined,
                    size: 64,
                    color: AppColors.textSecondary.withAlpha(128),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'No AI assistants yet',
                    style: TextStyle(
                      color: AppColors.textSecondary.withAlpha(128),
                      fontSize: 16,
                    ),
                  ),
                  const SizedBox(height: 24),
                  ElevatedButton.icon(
                    onPressed: () => _showAddAiDialog(context, ref),
                    icon: const Icon(Icons.add),
                    label: const Text('Add AI'),
                  ),
                ],
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: aiSessions.length,
              itemBuilder: (context, index) {
                final ai = aiSessions[index];
                return _AiCard(
                  ai: ai,
                  onTap: () => _openChat(context, ai),
                  onDelete: () => _deleteAi(context, ref, ai),
                );
              },
            ),
    );
  }

  void _showAddAiDialog(BuildContext context, WidgetRef ref) {
    final nameController = TextEditingController();
    final aiConfig = ref.read(aiConfigProvider);
    final mainAi = ref.read(mainAiProvider);

    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surfaceDark,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => StatefulBuilder(
        builder: (context, setState) => Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          child: SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const SizedBox(height: 8),
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.textSecondary.withAlpha(77),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Text(
                    mainAi == null ? 'Create Main AI' : 'Add Child AI',
                    style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                ),
                if (mainAi != null) ...[
                  const SizedBox(height: 8),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Text(
                      'Inherits: ${aiConfig.providerId}/${aiConfig.model ?? "default"}',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.textSecondary.withAlpha(179),
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 24),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: TextField(
                    controller: nameController,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      labelText: 'AI Name',
                      labelStyle: const TextStyle(
                        color: AppColors.textSecondary,
                      ),
                      hintText: 'e.g., My Helper',
                      hintStyle: const TextStyle(
                        color: AppColors.textSecondary,
                      ),
                      filled: true,
                      fillColor: AppColors.backgroundDark,
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: BorderSide.none,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: () async {
                        final name = nameController.text.trim().isEmpty
                            ? 'AI ${DateTime.now().millisecondsSinceEpoch % 1000}'
                            : nameController.text.trim();

                        // 子 AI 继承主 AI 的配置
                        final ai = await Identity.create(
                          name: name,
                          parentId: mainAi?.id,  // null 表示主 AI
                          providerId: aiConfig.providerId,
                          model: aiConfig.model,
                          config: aiConfig.config,
                        );

                        ref.read(aiSessionsProvider.notifier).addAi(ai);
                        ref.read(contactsProvider.notifier).addContact(ai);

                        // 如果是第一个 AI，设为主 AI
                        if (mainAi == null) {
                          ref.read(mainAiProvider.notifier).state = ai;
                        }

                        if (context.mounted) {
                          Navigator.pop(context);
                        }
                      },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      child: Text(mainAi == null ? 'Create Main AI' : 'Add AI'),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _openChat(BuildContext context, Identity ai) {
    Navigator.pushNamed(
      context,
      '/chat',
      arguments: {'id': ai.id, 'name': ai.name},
    );
  }

  void _deleteAi(BuildContext context, WidgetRef ref, Identity ai) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surfaceDark,
        title: const Text('Delete AI'),
        content: Text('Are you sure you want to delete ${ai.name}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              ref.read(aiSessionsProvider.notifier).removeAi(ai.id);
              Navigator.pop(context);
            },
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}

class _AiCard extends StatelessWidget {
  final Identity ai;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  const _AiCard({
    required this.ai,
    required this.onTap,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: AppColors.surfaceDark,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: AppColors.secondary,
                child: const Icon(
                  Icons.smart_toy,
                  color: Colors.white,
                  size: 28,
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          ai.name,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (ai.isMainAi) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withAlpha(51),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: const Text(
                              'Main',
                              style: TextStyle(
                                fontSize: 10,
                                color: AppColors.primary,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: ai.isOnline
                                ? AppColors.success
                                : AppColors.textSecondary,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          ai.isOnline ? 'Online' : 'Offline',
                          style: TextStyle(
                            fontSize: 12,
                            color: ai.isOnline
                                ? AppColors.success
                                : AppColors.textSecondary,
                          ),
                        ),
                        if (ai.providerId != null) ...[
                          const SizedBox(width: 8),
                          Text(
                            '${ai.providerId}${ai.model != null ? '/${ai.model}' : ''}',
                            style: TextStyle(
                              fontSize: 10,
                              color: AppColors.textSecondary.withAlpha(179),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                icon: const Icon(Icons.qr_code, color: AppColors.primary),
                onPressed: () => Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => MyQrScreen(identityParam: ai),
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline, color: AppColors.error),
                onPressed: onDelete,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
