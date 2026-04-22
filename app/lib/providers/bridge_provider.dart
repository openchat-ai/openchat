import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat/services/bridge_service.dart';

/// Bridge 服务 Provider
final bridgeServiceProvider = Provider<BridgeService>((ref) {
  final service = BridgeService();
  ref.onDispose(() => service.dispose());
  return service;
});

/// Bridge 连接状态
final bridgeConnectionProvider = StateNotifierProvider<BridgeConnectionNotifier, bool>((ref) {
  final service = ref.watch(bridgeServiceProvider);
  return BridgeConnectionNotifier(service);
});

class BridgeConnectionNotifier extends StateNotifier<bool> {
  final BridgeService _service;

  BridgeConnectionNotifier(this._service) : super(false);

  Future<bool> connect() async {
    final success = await _service.connect();
    state = success;
    return success;
  }

  void disconnect() {
    _service.disconnect();
    state = false;
  }
}

/// Bridge 消息流
final bridgeMessagesProvider = StreamProvider<BridgeMessage>((ref) {
  final service = ref.watch(bridgeServiceProvider);
  return service.messages;
});

/// Bridge 状态流
final bridgeStatusProvider = StreamProvider<BridgeStatus>((ref) {
  final service = ref.watch(bridgeServiceProvider);
  return service.status;
});

/// 当前 Provider/Model
final currentProviderProvider = StateProvider<String?>((ref) {
  final service = ref.watch(bridgeServiceProvider);
  return service.currentProvider;
});

final currentModelProvider = StateProvider<String?>((ref) {
  final service = ref.watch(bridgeServiceProvider);
  return service.currentModel;
});
