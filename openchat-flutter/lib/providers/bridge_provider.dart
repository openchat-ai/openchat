import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api/bridge_ws_client.dart';
import 'config_provider.dart';

final bridgeWsProvider = Provider<BridgeWsClient>((ref) {
  final config = ref.watch(configProvider);
  final uri = Uri.parse(config.baseUrl);
  final client = BridgeWsClient(host: uri.host, port: uri.port);
  if (config.token != null) client.configure(token: config.token);
  client.connect();
  ref.onDispose(() => client.dispose());
  return client;
});

final bridgeConnectionProvider = StreamProvider<bool>((ref) {
  final client = ref.watch(bridgeWsProvider);
  return client.connectionStatus;
});
