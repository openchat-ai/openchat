import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/message.dart';

class MessagesNotifier extends StateNotifier<Map<String, List<Message>>> {
  MessagesNotifier() : super({});

  void addMessage(String peerId, Message message) {
    final messages = state[peerId] ?? [];
    state = {
      ...state,
      peerId: [...messages, message],
    };
  }

  void updateMessage(String peerId, Message message) {
    final messages = state[peerId] ?? [];
    state = {
      ...state,
      peerId: messages.map((m) => m.id == message.id ? message : m).toList(),
    };
  }

  void markAsRead(String peerId, String messageId) {
    final messages = state[peerId] ?? [];
    final message = messages.firstWhere((m) => m.id == messageId);
    updateMessage(peerId, message.copyWith(isRead: true));
  }

  void markAllAsRead(String peerId) {
    final messages = state[peerId] ?? [];
    state = {
      ...state,
      peerId: messages.map((m) => m.copyWith(isRead: true)).toList(),
    };
  }

  List<Message> getMessages(String peerId) {
    return state[peerId] ?? [];
  }

  void clearMessages(String peerId) {
    state = {...state, peerId: []};
  }
}

final messagesProvider =
    StateNotifierProvider<MessagesNotifier, Map<String, List<Message>>>((ref) {
      return MessagesNotifier();
    });

final chatMessagesProvider = Provider.family<List<Message>, String>((
  ref,
  peerId,
) {
  final messages = ref.watch(messagesProvider);
  return messages[peerId] ?? [];
});
