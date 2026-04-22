import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/models/user_identity.dart';

class AiSessionsNotifier extends StateNotifier<List<Identity>> {
  AiSessionsNotifier() : super([]);

  void addAi(Identity ai) {
    state = [...state, ai];
  }

  void removeAi(String id) {
    state = state.where((ai) => ai.id != id).toList();
  }

  void updateAiStatus(String id, bool isOnline) {
    state = state.map((ai) {
      if (ai.id == id) {
        return ai.copyWith(isOnline: isOnline);
      }
      return ai;
    }).toList();
  }

  void updateAi(Identity ai) {
    state = state.map((a) => a.id == ai.id ? ai : a).toList();
  }
}

final aiSessionsProvider =
    StateNotifierProvider<AiSessionsNotifier, List<Identity>>((ref) {
  return AiSessionsNotifier();
});

// 主 AI 配置（provider + model + 个性化配置）
// 子 AI 会继承这个配置
final aiConfigProvider = StateProvider<AiConfig>((ref) => const AiConfig(
  providerId: 'openai',
  model: 'gpt-4o-mini',
));

// 主 AI Identity（每个 Bridge 一个）
final mainAiProvider = StateProvider<Identity?>((ref) => null);

// 子 AI 列表（主 AI 的 children）
final childAisProvider = Provider<List<Identity>>((ref) {
  final mainAi = ref.watch(mainAiProvider);
  if (mainAi == null) return [];
  final sessions = ref.watch(aiSessionsProvider);
  return sessions.where((ai) => ai.parentId == mainAi.id).toList();
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
