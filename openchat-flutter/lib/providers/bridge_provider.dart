import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api/bridge_ws_client.dart';

final bridgeWsProvider = Provider<BridgeWsClient>((ref) {
  final client = BridgeWsClient(port: 3800);
  client.connect();
  ref.onDispose(() => client.dispose());
  return client;
});

final bridgeConnectionProvider = StreamProvider<bool>((ref) {
  final client = ref.watch(bridgeWsProvider);
  return client.connectionStatus;
});
