import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import 'dht_node.dart';
import '../p2p_manager.dart';

/// 基于 DHT 的节点发现服务
/// 完全去中心化，无需任何服务器
class DhtPeerDiscovery {
  final DhtNode dhtNode;
  final String myPeerId;
  final String? bridgeUrl;

  /// 用户信息存储的 DHT key 前缀
  static const String _peerInfoPrefix = 'openchat:peer:';

  /// 已知的 bootstrap 节点 (可以是任意在线节点)
  final List<DhtPeer> _bootstrapPeers = [];

  final _peerDiscoveredController = StreamController<PeerInfo>.broadcast();
  BridgeDhtTransport? _transport;

  DhtPeerDiscovery({
    required this.myPeerId,
    DhtNode? dhtNode,
    this.bridgeUrl,
  }) : dhtNode = dhtNode ?? DhtNode();

  /// 发现新节点事件
  Stream<PeerInfo> get peerDiscovered => _peerDiscoveredController.stream;

  /// 启动 DHT 发现服务
  Future<void> start() async {
    // 如果提供了 Bridge URL，创建传输层
    if (bridgeUrl != null) {
      _transport = BridgeDhtTransport(
        bridgeUrl: bridgeUrl!,
        localNodeId: dhtNode.nodeId,
      );
      await _transport!.connect();
      // 将传输层注入 DHT 节点
      _injectTransport();
    }

    // 监听 DHT 发现的节点
    dhtNode.peerFound.listen((peer) {
      _onPeerFound(peer);
    });

    // 启动 DHT 节点
    await dhtNode.start(_bootstrapPeers);

    // 发布自己的信息
    await _publishMyInfo();

    debugPrint('[DHT] Discovery service started, node ID: ${dhtNode.nodeId.toHex()}');
  }

  /// 将传输层注入 DHT 节点
  void _injectTransport() {
    if (_transport == null) return;
    dhtNode.setTransport(_transport!);

    // 将 Bridge 服务器添加为 bootstrap 节点
    if (bridgeUrl != null) {
      // Bridge 服务器作为种子节点，使用可配置的 nodeId
      // 默认使用 Bridge 的 WebSocket 地址派生一个固定 nodeId
      final bridgeNodeId = _addressToDhtId(bridgeUrl!);
      final bridgePeer = DhtPeer(
        id: bridgeNodeId,
        address: bridgeUrl!,
      );
      addBootstrapPeer(bridgePeer);
      debugPrint('[DHT] Added Bridge as bootstrap peer: ${bridgeNodeId.toHex()}');
    }
  }

  /// 从地址派生一个固定的 DhtId（用于 Bridge 种子节点）
  DhtId _addressToDhtId(String address) {
    final bytes = utf8.encode('openchat:bridge:seed:$address');
    final hash = Uint8List(20);
    for (var i = 0; i < 20; i++) {
      hash[i] = bytes[i];
    }
    return DhtId(hash);
  }

  /// 添加 bootstrap 节点
  void addBootstrapPeer(DhtPeer peer) {
    _bootstrapPeers.add(peer);
  }

  /// 通过 peerId 查找用户
  Future<PeerInfo?> findPeer(String peerId) async {
    // 将 peerId 转换为 DHT key
    final key = _peerIdToKey(peerId);

    // 从 DHT 获取用户信息
    final data = await dhtNode.get(key);
    if (data == null) return null;

    return PeerInfo.fromJson(data.value);
  }

  /// 发布自己的信息
  Future<void> _publishMyInfo() async {
    final myInfo = PeerInfo(
      peerId: myPeerId,
      nodeId: dhtNode.nodeId.toHex(),
      name: '', // 用户名，可以从设置读取
      timestamp: DateTime.now(),
    );

    final key = _peerIdToKey(myPeerId);
    await dhtNode.put(key, myInfo.toJson());

    debugPrint('[DHT] Published peer info: $myPeerId');
  }

  /// 更新自己的信息
  Future<void> updateMyInfo({String? name, String? avatar}) async {
    final myInfo = PeerInfo(
      peerId: myPeerId,
      nodeId: dhtNode.nodeId.toHex(),
      name: name ?? '',
      avatar: avatar,
      timestamp: DateTime.now(),
    );

    final key = _peerIdToKey(myPeerId);
    await dhtNode.put(key, myInfo.toJson());
  }

  /// 处理发现的节点
  void _onPeerFound(DhtPeer peer) async {
    // 尝试获取节点信息
    final key = _peerIdToKey(peer.id.toHex());
    final data = await dhtNode.get(key);

    if (data != null) {
      try {
        final peerInfo = PeerInfo.fromJson(data.value);
        _peerDiscoveredController.add(peerInfo);
      } catch (e) {
        debugPrint('[DHT] Failed to parse peer info: $e');
      }
    }
  }

  /// peerId 转 DHT key
  DhtId _peerIdToKey(String peerId) {
    // 使用 peerId 的哈希作为 key
    final bytes = utf8.encode(_peerInfoPrefix + peerId);
    // 简化处理：取前 20 字节
    final hash = Uint8List(20);
    for (var i = 0; i < 20 && i < bytes.length; i++) {
      hash[i] = bytes[i];
    }
    return DhtId(hash);
  }

  /// 定期刷新
  Future<void> refresh() async {
    await dhtNode.refresh();
    await _publishMyInfo();
  }

  void dispose() {
    _transport?.close();
    dhtNode.dispose();
    _peerDiscoveredController.close();
  }
}

/// 节点信息
class PeerInfo {
  final String peerId;
  final String nodeId;
  final String name;
  final String? avatar;
  final DateTime timestamp;

  PeerInfo({
    required this.peerId,
    required this.nodeId,
    required this.name,
    this.avatar,
    required this.timestamp,
  });

  Map<String, dynamic> toJson() => {
    'peerId': peerId,
    'nodeId': nodeId,
    'name': name,
    'avatar': avatar,
    'timestamp': timestamp.millisecondsSinceEpoch,
  };

  factory PeerInfo.fromJson(Map<String, dynamic> json) => PeerInfo(
    peerId: json['peerId'] as String,
    nodeId: json['nodeId'] as String,
    name: json['name'] as String? ?? '',
    avatar: json['avatar'] as String?,
    timestamp: DateTime.fromMillisecondsSinceEpoch(json['timestamp'] as int),
  );
}

/// DHT + WebRTC 集成
class DhtP2PManager {
  final DhtPeerDiscovery discovery;
  final P2PManager p2pManager;

  final _connectionRequestedController = StreamController<String>.broadcast();

  DhtP2PManager({
    required this.discovery,
    required this.p2pManager,
  });

  /// 收到连接请求
  Stream<String> get connectionRequested => _connectionRequestedController.stream;

  /// 通过 peerId 连接
  /// 优先使用 signaling（WebRTC），fallback 到纯 DHT 方式
  Future<P2PPeerConnection?> connectToPeer(String peerId) async {
    // 如果有 signaling 客户端且已连接，使用标准 WebRTC signaling 流程
    if (p2pManager.signalingClient != null && p2pManager.signalingClient!.isConnected) {
      debugPrint('[DHT-P2P] Using signaling for peer $peerId');
      return p2pManager.connectToPeer(peerId);
    }

    // Fallback: 通过 DHT 获取对方的 Offer
    final peerInfo = await discovery.findPeer(peerId);
    if (peerInfo == null) {
      debugPrint('[DHT-P2P] Peer not found: $peerId');
      return null;
    }

    final offerKey = DhtId.fromHex(peerInfo.nodeId);
    final offerData = await discovery.dhtNode.get(offerKey);

    if (offerData?.value is! Map) {
      debugPrint('[DHT-P2P] No connection offer found for ${peerInfo.nodeId}');
      return null;
    }

    final conn = await p2pManager.connectToPeer(peerId);
    final offer = offerData!.value as Map<String, dynamic>;

    final sdp = RTCSessionDescription(
      offer['sdp'] as String,
      offer['type'] as String,
    );
    await conn.setRemoteDescription(sdp);

    final answer = await conn.createAnswer();
    await _publishAnswer(peerInfo.nodeId, answer);

    debugPrint('[DHT-P2P] Connected to $peerId via DHT');
    return conn;
  }

  /// 发布 WebRTC Offer (作为被叫方)
  Future<void> publishOffer() async {
    // 为每个想连接的人创建一个待接听的 offer
    final tempConn = await createTemporaryOffer();
    if (tempConn == null) return;

    final offer = await tempConn.createOffer();

    final key = discovery.dhtNode.nodeId;
    await discovery.dhtNode.put(key, {
      'sdp': offer.sdp,
      'type': offer.type,
      'peerId': discovery.myPeerId,
    });
  }

  /// 发布 Answer
  Future<void> _publishAnswer(String targetNodeId, RTCSessionDescription answer) async {
    // 使用 targetNodeId 作为 key，接收方通过同一 key 检索
    final key = DhtId.fromHex(targetNodeId);
    await discovery.dhtNode.put(key, {
      'sdp': answer.sdp,
      'type': answer.type,
    });
  }

  /// 发布 WebRTC Offer (作为被叫方) - 供外部调用
  Future<P2PPeerConnection?> createTemporaryOffer() async {
    try {
      // 创建待接听的连接
      final conn = P2PPeerConnection(
        peerId: 'incoming',
        myPeerId: discovery.myPeerId,
      );
      await conn.initialize();

      // 创建 offer
      final offer = await conn.createOffer();

      // 发布到 DHT（用本地 nodeId 作为 key）
      final key = discovery.dhtNode.nodeId;
      await discovery.dhtNode.put(key, {
        'sdp': offer.sdp,
        'type': offer.type,
        'peerId': discovery.myPeerId,
      });

      debugPrint('[DHT-P2P] Published offer for incoming connections');
      return conn;
    } catch (e) {
      debugPrint('[DHT-P2P] Failed to create temporary offer: $e');
      return null;
    }
  }

  void dispose() {
    discovery.dispose();
    p2pManager.dispose();
    _connectionRequestedController.close();
  }
}
