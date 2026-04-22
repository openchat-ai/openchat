import 'package:flutter_test/flutter_test.dart';
import 'package:openchat/core/ai/ai_service.dart';
import 'package:openchat/core/ai/ai_resident.dart';

void main() {
  group('AiService', () {
    late AiService service;

    setUp(() {
      service = AiService(bridgeUrl: 'ws://localhost:3003');
    });

    tearDown(() {
      service.dispose();
    });

    test('创建服务实例', () {
      expect(service.bridgeUrl, 'ws://localhost:3003');
      expect(service.allResidents, isEmpty);
    });

    test('添加 Resident', () async {
      final resident = AiResident.create(
        name: '测试助手',
        description: '测试用 AI',
        providerType: 'openai',
        model: 'gpt-4o',
      );

      await service.addResident(resident);

      expect(service.allResidents.length, 1);
      expect(service.getResident(resident.identity.id), isNotNull);
    });

    test('移除 Resident', () async {
      final resident = service.createDefaultResident();
      await service.addResident(resident);

      expect(service.allResidents.length, 1);

      await service.removeResident(resident.identity.id);

      expect(service.allResidents, isEmpty);
      expect(service.getResident(resident.identity.id), isNull);
    });

    test('创建默认 Resident', () {
      final resident = service.createDefaultResident();

      expect(resident.identity.name, '小智');
      expect(resident.identity.description, '一个友善的AI助手');
    });

    test('发送消息到不存在的 Resident 抛出异常', () async {
      expect(
        () => service.sendMessage('non-existent', 'Hello'),
        throwsException,
      );
    });

    test('发送消息并收到响应', () async {
      final resident = service.createDefaultResident();
      await service.addResident(resident);

      final response = await service.sendMessage(resident.identity.id, '你好');

      expect(response, isNotEmpty);
      expect(response, contains('你好'));
    });

    test('消息流可用', () {
      final stream = service.getMessageStream('test-id');

      expect(stream, isNotNull);
    });

    test('residents 流可用', () {
      expect(service.residents, isNotNull);
    });
  });

  group('AiProvider', () {
    late AiProvider provider;

    setUp(() {
      provider = AiProvider();
    });

    tearDown(() {
      provider.dispose();
    });

    test('创建 Provider 实例', () {
      expect(provider.residents, isEmpty);
    });

    test('设置和获取 API Key', () {
      provider.setApiKey('openai', 'sk-test-key');

      expect(provider.getApiKey('openai'), 'sk-test-key');
      expect(provider.getApiKey('unknown'), isNull);
    });

    test('添加 Resident 会通知监听器', () async {
      var notified = false;
      provider.addListener(() {
        notified = true;
      });

      final resident = provider.createDefaultResident();
      await provider.addResident(resident);

      expect(notified, true);
    });

    test('移除 Resident 会通知监听器', () async {
      final resident = provider.createDefaultResident();
      await provider.addResident(resident);

      var notified = false;
      provider.addListener(() {
        notified = true;
      });

      await provider.removeResident(resident.identity.id);

      expect(notified, true);
    });

    test('发送消息会通知监听器', () async {
      final resident = provider.createDefaultResident();
      await provider.addResident(resident);

      var notified = false;
      provider.addListener(() {
        notified = true;
      });

      await provider.sendMessage(resident.identity.id, '你好');

      expect(notified, true);
    });
  });
}
