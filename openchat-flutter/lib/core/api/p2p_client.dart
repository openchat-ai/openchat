import 'package:openchat_flutter/core/api/base_client.dart';

class P2PClient extends BaseClient {
  P2PClient({required super.baseUrl, super.token});

  Future<P2PMessage> sendMessage({required String type, String? targetPeerId, required Map<String, dynamic> payload, String priority = 'NORMAL'}) async {
    final response = await dio.post('$baseUrl/api/v1/p2p/messages', data: {'type': type, 'targetPeerId': targetPeerId, 'payload': payload, 'priority': priority});
    return P2PMessage.fromJson(response.data);
  }

  Future<P2PMessage> getMessage(String id) async {
    final response = await dio.get('$baseUrl/api/v1/p2p/messages/$id');
    return P2PMessage.fromJson(response.data);
  }

  Future<InboxResult> getInbox({String? status, int limit = 50}) async {
    final response = await dio.get('$baseUrl/api/v1/p2p/inbox', queryParameters: {'status': status, 'limit': limit});
    return InboxResult.fromJson(response.data);
  }

  Future<PeerList> getPeers() async {
    final response = await dio.get('$baseUrl/api/v1/p2p/peers');
    return PeerList.fromJson(response.data);
  }

  Future<Peer> connectPeer(String id, String peerAddress) async {
    final response = await dio.post('$baseUrl/api/v1/p2p/peers/$id/connect', data: {'peerAddress': peerAddress});
    return Peer.fromJson(response.data);
  }

  Future<Peer> disconnectPeer(String id) async {
    final response = await dio.delete('$baseUrl/api/v1/p2p/peers/$id');
    return Peer.fromJson(response.data);
  }

  Future<P2PStats> getStats() async {
    final response = await dio.get('$baseUrl/api/v1/p2p/stats');
    return P2PStats.fromJson(response.data);
  }

  Future<P2PConfigResult> updateConfig({String? encryption, bool? discoveryEnabled, int? maxPeers}) async {
    final response = await dio.put('$baseUrl/api/v1/p2p/config', data: {'encryption': encryption, 'discoveryEnabled': discoveryEnabled, 'maxPeers': maxPeers});
    return P2PConfigResult.fromJson(response.data);
  }
}

class P2PMessage {
  final String id, type, sourcePeerId, priority, status, createdAt;
  final String? targetPeerId, deliveredAt;
  final Map<String, dynamic> payload;

  P2PMessage({required this.id, required this.type, required this.sourcePeerId, this.targetPeerId, required this.payload, required this.priority, required this.status, required this.createdAt, this.deliveredAt});

  factory P2PMessage.fromJson(Map<String, dynamic> json) {
    return P2PMessage(
      id: json['id'] ?? '',
      type: json['type'] ?? '',
      sourcePeerId: json['sourcePeerId'] ?? '',
      targetPeerId: json['targetPeerId'],
      payload: Map<String, dynamic>.from(json['payload'] ?? {}),
      priority: json['priority'] ?? 'NORMAL',
      status: json['status'] ?? '',
      createdAt: json['createdAt'] ?? '',
      deliveredAt: json['deliveredAt'],
    );
  }
}

class InboxResult {
  final List<P2PMessage> messages;
  final int total;

  InboxResult({required this.messages, required this.total});

  factory InboxResult.fromJson(Map<String, dynamic> json) {
    return InboxResult(messages: (json['messages'] as List? ?? []).map((m) => P2PMessage.fromJson(m)).toList(), total: json['total'] ?? 0);
  }
}

class Peer {
  final String id, status;
  final String? address, connectedAt, disconnectedAt;

  Peer({required this.id, this.address, required this.status, this.connectedAt, this.disconnectedAt});

  factory Peer.fromJson(Map<String, dynamic> json) {
    return Peer(id: json['id'] ?? '', address: json['address'], status: json['status'] ?? '', connectedAt: json['connectedAt'], disconnectedAt: json['disconnectedAt']);
  }
}

class PeerList {
  final List<Peer> peers;
  final int total;

  PeerList({required this.peers, required this.total});

  factory PeerList.fromJson(Map<String, dynamic> json) {
    return PeerList(peers: (json['peers'] as List? ?? []).map((p) => Peer.fromJson(p)).toList(), total: json['total'] ?? 0);
  }
}

class P2PStats {
  final PeerStats peers;
  final MessageStats messages;
  final P2PConfig config;

  P2PStats({required this.peers, required this.messages, required this.config});

  factory P2PStats.fromJson(Map<String, dynamic> json) {
    return P2PStats(peers: PeerStats.fromJson(json['peers'] ?? {}), messages: MessageStats.fromJson(json['messages'] ?? {}), config: P2PConfig.fromJson(json['config'] ?? {}));
  }
}

class PeerStats {
  final int total, connected, connecting;

  PeerStats({required this.total, required this.connected, required this.connecting});

  factory PeerStats.fromJson(Map<String, dynamic> json) {
    return PeerStats(total: json['total'] ?? 0, connected: json['connected'] ?? 0, connecting: json['connecting'] ?? 0);
  }
}

class MessageStats {
  final int total, pending, delivered;

  MessageStats({required this.total, required this.pending, required this.delivered});

  factory MessageStats.fromJson(Map<String, dynamic> json) {
    return MessageStats(total: json['total'] ?? 0, pending: json['pending'] ?? 0, delivered: json['delivered'] ?? 0);
  }
}

class P2PConfig {
  final String encryption;
  final bool discoveryEnabled;
  final int maxPeers;

  P2PConfig({required this.encryption, required this.discoveryEnabled, required this.maxPeers});

  factory P2PConfig.fromJson(Map<String, dynamic> json) {
    return P2PConfig(encryption: json['encryption'] ?? 'TLS', discoveryEnabled: json['discoveryEnabled'] ?? true, maxPeers: json['maxPeers'] ?? 50);
  }
}

class P2PConfigResult {
  final P2PConfig config;
  final String updatedAt;

  P2PConfigResult({required this.config, required this.updatedAt});

  factory P2PConfigResult.fromJson(Map<String, dynamic> json) {
    return P2PConfigResult(config: P2PConfig.fromJson(json['config'] ?? {}), updatedAt: json['updatedAt'] ?? '');
  }
}