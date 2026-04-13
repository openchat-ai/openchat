import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/conversation.dart';

final conversationsProvider =
    StateNotifierProvider<ConversationsNotifier, List<Conversation>>((ref) {
      return ConversationsNotifier();
    });

class ConversationsNotifier extends StateNotifier<List<Conversation>> {
  ConversationsNotifier() : super([]);

  void addConversation(Conversation conversation) {
    final exists = state.any((c) => c.peerId == conversation.peerId);
    if (!exists) {
      state = [...state, conversation];
    }
  }

  void updateConversation(Conversation conversation) {
    state = state.map((c) {
      if (c.peerId == conversation.peerId) {
        return conversation;
      }
      return c;
    }).toList();
  }

  void removeConversation(String peerId) {
    state = state.where((c) => c.peerId != peerId).toList();
  }
}
