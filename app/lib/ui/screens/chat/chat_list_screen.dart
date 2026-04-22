import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/providers/contacts_provider.dart';
import 'package:openchat/providers/conversations_provider.dart';
import 'package:openchat/ui/widgets/common/conversation_tile.dart';
import 'package:openchat/ui/theme/colors.dart';

class ChatListScreen extends ConsumerStatefulWidget {
  const ChatListScreen({super.key});

  @override
  ConsumerState<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends ConsumerState<ChatListScreen> {
  @override
  Widget build(BuildContext context) {
    final conversations = ref.watch(conversationsProvider);
    final contacts = ref.watch(contactsProvider);

    final sortedConversations = conversations.toList()
      ..sort((a, b) => b.lastMessageTime.compareTo(a.lastMessageTime));

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            floating: true,
            title: const Text('Chats'),
            actions: [
              IconButton(icon: const Icon(Icons.search), onPressed: () {}),
              IconButton(icon: const Icon(Icons.more_vert), onPressed: () {}),
            ],
          ),
          if (sortedConversations.isEmpty)
            SliverFillRemaining(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.chat_bubble_outline,
                      size: 64,
                      color: AppColors.textSecondary.withAlpha(128),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'No conversations yet',
                      style: TextStyle(
                        color: AppColors.textSecondary.withAlpha(128),
                        fontSize: 16,
                      ),
                    ),
                  ],
                ),
              ),
            )
          else
            SliverList(
              delegate: SliverChildBuilderDelegate((context, index) {
                final conversation = sortedConversations[index];
                final contact = contacts.firstWhere(
                  (c) => c.id == conversation.peerId,
                  orElse: () => contacts.first,
                );

                return ConversationTile(
                  conversation: conversation,
                  contact: contact,
                  onTap: () {
                    Navigator.pushNamed(
                      context,
                      '/chat',
                      arguments: {
                        'id': conversation.peerId,
                        'name': contact.name,
                      },
                    );
                  },
                );
              }, childCount: sortedConversations.length),
            ),
        ],
      ),
    );
  }
}
