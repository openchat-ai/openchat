import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/providers/ai_provider.dart';
import 'package:openchat/models/user_identity.dart';

void main() {
  group('AiSessionsNotifier', () {
    late ProviderContainer container;
    late AiSessionsNotifier notifier;

    setUp(() {
      container = ProviderContainer();
      notifier = container.read(aiSessionsProvider.notifier);
    });

    tearDown(() {
      container.dispose();
    });

    test('初始状态为空列表', () {
      expect(container.read(aiSessionsProvider), isEmpty);
    });

    test('添加 AI Session', () async {
      final ai = await Identity.create(name: '小智');

      notifier.addAi(ai);

      final state = container.read(aiSessionsProvider);
      expect(state.length, 1);
      expect(state.first.id, ai.id);
    });

    test('移除 AI Session', () async {
      final ai = await Identity.create(name: '小慧');

      notifier.addAi(ai);
      expect(container.read(aiSessionsProvider).length, 1);

      notifier.removeAi(ai.id);
      expect(container.read(aiSessionsProvider), isEmpty);
    });

    test('更新 AI 在线状态', () async {
      final ai = await Identity.create(name: '小智');

      notifier.addAi(ai);

      notifier.updateAiStatus(ai.id, false);

      final state = container.read(aiSessionsProvider);
      expect(state.first.isOnline, false);
    });

    test('更新不存在的 AI 不影响状态', () async {
      final ai = await Identity.create(name: '小智');

      notifier.addAi(ai);
      notifier.updateAiStatus('non-existent', false);

      final state = container.read(aiSessionsProvider);
      expect(state.first.isOnline, true);
    });

    test('添加多个 AI Sessions', () async {
      for (var i = 0; i < 5; i++) {
        notifier.addAi(await Identity.create(name: 'AI $i'));
      }

      expect(container.read(aiSessionsProvider).length, 5);
    });
  });

  group('aiProvidersProvider', () {
    late ProviderContainer container;

    setUp(() {
      container = ProviderContainer();
    });

    tearDown(() {
      container.dispose();
    });

    test('返回预定义的 AI 提供商列表', () {
      final providers = container.read(aiProvidersProvider);

      expect(providers, isNotEmpty);
      expect(providers.any((p) => p.id == 'openai'), true);
      expect(providers.any((p) => p.id == 'claude'), true);
      expect(providers.any((p) => p.id == 'gemini'), true);
      expect(providers.any((p) => p.id == 'deepseek'), true);
    });

    test('每个提供商都有模型列表', () {
      final providers = container.read(aiProvidersProvider);

      for (final provider in providers) {
        expect(provider.models, isNotEmpty);
      }
    });
  });

  group('AiProviderInfo', () {
    test('创建提供商信息', () {
      final info = AiProviderInfo(
        id: 'test-provider',
        name: 'Test Provider',
        models: ['model-1', 'model-2'],
      );

      expect(info.id, 'test-provider');
      expect(info.name, 'Test Provider');
      expect(info.models.length, 2);
    });
  });
}
