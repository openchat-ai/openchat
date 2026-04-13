import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/user_identity.dart';

class AiSessionsNotifier extends StateNotifier<List<UserIdentity>> {
  AiSessionsNotifier() : super([]);

  void addAi(UserIdentity ai) {
    state = [...state, ai];
  }

  void removeAi(String peerId) {
    state = state.where((ai) => ai.peerId != peerId).toList();
  }

  void updateAiStatus(String peerId, bool isOnline) {
    state = state.map((ai) {
      if (ai.peerId == peerId) {
        return ai.copyWith(isOnline: isOnline);
      }
      return ai;
    }).toList();
  }
}

final aiSessionsProvider =
    StateNotifierProvider<AiSessionsNotifier, List<UserIdentity>>((ref) {
      return AiSessionsNotifier();
    });

final aiProvidersProvider = Provider<List<AiProviderInfo>>((ref) {
  return [
    AiProviderInfo(
      id: 'openai',
      name: 'OpenAI',
      models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
    ),
    AiProviderInfo(
      id: 'claude',
      name: 'Claude',
      models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku'],
    ),
    AiProviderInfo(
      id: 'gemini',
      name: 'Gemini',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    ),
    AiProviderInfo(
      id: 'deepseek',
      name: 'DeepSeek',
      models: ['deepseek-chat', 'deepseek-coder'],
    ),
  ];
});

class AiProviderInfo {
  final String id;
  final String name;
  final List<String> models;

  AiProviderInfo({required this.id, required this.name, required this.models});
}
