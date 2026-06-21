import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/core/api/base_client.dart';
import 'config_provider.dart';

// Client Providers（自动读取配置）
final agentClientProvider = Provider<AgentClient>((ref) {
  final config = ref.watch(configProvider);
  return AgentClient(baseUrl: config.baseUrl, token: config.token);
});

final metricsClientProvider = Provider<MetricsClient>((ref) {
  final config = ref.watch(configProvider);
  return MetricsClient(baseUrl: config.baseUrl, token: config.token);
});

final resourcesClientProvider = Provider<ResourcesClient>((ref) {
  final config = ref.watch(configProvider);
  return ResourcesClient(baseUrl: config.baseUrl, token: config.token);
});

final p2pClientProvider = Provider<P2PClient>((ref) {
  final config = ref.watch(configProvider);
  return P2PClient(baseUrl: config.baseUrl, token: config.token);
});

final skillsClientProvider = Provider<SkillsClient>((ref) {
  final config = ref.watch(configProvider);
  return SkillsClient(baseUrl: config.baseUrl, token: config.token);
});

final feedbackClientProvider = Provider<FeedbackClient>((ref) {
  final config = ref.watch(configProvider);
  return FeedbackClient(baseUrl: config.baseUrl, token: config.token);
});

final decisionsClientProvider = Provider<DecisionsClient>((ref) {
  final config = ref.watch(configProvider);
  return DecisionsClient(baseUrl: config.baseUrl, token: config.token);
});

final updatesClientProvider = Provider<UpdatesClient>((ref) {
  final config = ref.watch(configProvider);
  return UpdatesClient(baseUrl: config.baseUrl, token: config.token);
});

final versionsClientProvider = Provider<VersionsClient>((ref) {
  final config = ref.watch(configProvider);
  return VersionsClient(baseUrl: config.baseUrl, token: config.token);
});

final residentClientProvider = Provider<ResidentClient>((ref) {
  final config = ref.watch(configProvider);
  return ResidentClient(baseUrl: config.baseUrl, token: config.token);
});

final sageClientProvider = Provider<SageClient>((ref) {
  final config = ref.watch(configProvider);
  return SageClient(baseUrl: config.baseUrl, token: config.token);
});
