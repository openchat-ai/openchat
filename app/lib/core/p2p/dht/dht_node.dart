import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// Kademlia DHT 节点实现
/// 完全去中心化的节点发现协议
class DhtNode {
  /// 节点 ID (160-bit)
  final DhtId nodeId;

  /// 本地存储的数据
  final Map<String, _DhtValue> _storage = {};

  /// 路由表 (k-buckets)
  final DhtRoutingTable _routingTable;

  /// RPC 客户端映射
  final Map<String, DhtPeer> _peers = {};

  /// K 参数 (每个 bucket 最多存储的节点数)
  static const int k = 20;

  /// Alpha 参数 (并发查询数)
  static const int alpha = 3;

  /// 数据过期时间 (24小时)
  static const Duration defaultTtl = Duration(hours: 24);

  final _peerFoundController = StreamController<DhtPeer>.broadcast();
  final _dataReceivedController = StreamController<DhtData>.broadcast();

  DhtNode({DhtId? nodeId, DhtTransport? transport})
      : nodeId = nodeId ?? DhtId.random(),
        _routingTable = DhtRoutingTable(
          k: k,
          localNodeId: nodeId ?? DhtId.random(),
        ),
        _transport = transport;

  DhtTransport? _transport;

  /// 设置传输层
  void setTransport(DhtTransport transport) {
    _transport = transport;
  }

  /// 发现新节点事件
  Stream<DhtPeer> get peerFound => _peerFoundController.stream;

  /// 收到数据事件
  Stream<DhtData> get dataReceived => _dataReceivedController.stream;

  /// 启动 DHT 节点
  Future<void> start(List<DhtPeer> bootstrapPeers) async {
    // 将 bootstrap 节点加入路由表
    for (final peer in bootstrapPeers) {
      _routingTable.add(peer);
      _peers[peer.id.toHex()] = peer;
    }

    // 执行自举：查找自己的 ID，发现更多节点
    await _bootstrap();
  }

  /// 自举过程：通过查找自己发现附近节点
  Future<void> _bootstrap() async {
    await findNode(nodeId);
  }

  /// 查找节点 (FIND_NODE RPC)
  Future<List<DhtPeer>> findNode(DhtId target) async {
    final visited = <String>{};
    final closest = <DhtPeer>[];
    var pending = _routingTable.findClosest(target, alpha);

    while (pending.isNotEmpty) {
      final toQuery = pending.take(alpha).toList();
      pending = pending.skip(alpha).toList();

      final futures = toQuery.map((peer) async {
        if (visited.contains(peer.id.toHex())) return null;
        visited.add(peer.id.toHex());

        try {
          final response = await _sendFindNode(peer, target);
          return response;
        } catch (e) {
          // 节点不可达，从路由表移除
          _routingTable.remove(peer);
          return null;
        }
      });

      final results = await Future.wait(futures);

      for (final result in results) {
        if (result == null) continue;
        for (final peer in result) {
          if (!visited.contains(peer.id.toHex())) {
            _routingTable.add(peer);
            _peers[peer.id.toHex()] = peer;
            _peerFoundController.add(peer);
            pending.add(peer);
          }
        }
      }

      // 更新最近的节点列表
      closest.addAll(pending);
      closest.sort((a, b) => a.id.xorDistance(target).compareTo(b.id.xorDistance(target)));

      if (closest.length > k) {
        closest.removeRange(k, closest.length);
      }

      // 检查是否收敛
      if (_isConverged(closest, target)) break;
    }

    return closest;
  }

  /// 存储 数据
  Future<void> put(DhtId key, dynamic value, {Duration? ttl}) async {
    final data = DhtData(
      key: key,
      value: value,
      timestamp: DateTime.now(),
      ttl: ttl ?? defaultTtl,
    );

    // 找到距离 key 最近的 k 个节点
    final closest = await findNode(key);

    // 并行发送 STORE RPC
    await Future.wait(
      closest.map((peer) => _sendStore(peer, data)),
    );

    // 本地也存储一份
    _storage[key.toHex()] = _DhtValue(data: data, lastRefresh: DateTime.now());
  }

  /// 获取数据 (GET)
  Future<DhtData?> get(DhtId key) async {
    // 先查本地
    final local = _storage[key.toHex()];
    if (local != null && !local.isExpired) {
      return local.data;
    }

    // 查找距离 key 最近的节点
    final closest = await findNode(key);

    // 并行发送 FIND_VALUE RPC
    for (final peer in closest) {
      try {
        final data = await _sendFindValue(peer, key);
        if (data != null) {
          // 缓存到本地
          _storage[key.toHex()] = _DhtValue(data: data, lastRefresh: DateTime.now());
          _dataReceivedController.add(data);
          return data;
        }
      } catch (e) {
        continue;
      }
    }

    return null;
  }

  /// 处理收到的 FIND_NODE 请求
  List<DhtPeer> handleFindNode(DhtId target) {
    return _routingTable.findClosest(target, k);
  }

  /// 处理收到的 STORE 请求
  void handleStore(DhtData data) {
    _storage[data.key.toHex()] = _DhtValue(
      data: data,
      lastRefresh: DateTime.now(),
    );
  }

  /// 处理收到的 FIND_VALUE 请求
  DhtData? handleFindValue(DhtId key) {
    final value = _storage[key.toHex()];
    if (value != null && !value.isExpired) {
      return value.data;
    }
    return null;
  }

  /// 发送 FIND_NODE RPC
  Future<List<DhtPeer>> _sendFindNode(DhtPeer peer, DhtId target) async {
    // 通过 WebRTC DataChannel 发送
    final message = DhtMessage(
      type: DhtMessageType.findNode,
      senderId: nodeId,
      targetId: target,
    );

    final response = await _sendRpc(peer, message);
    if (response?.peers != null) {
      return response!.peers!;
    }
    return [];
  }

  /// 发送 STORE RPC
  Future<bool> _sendStore(DhtPeer peer, DhtData data) async {
    final message = DhtMessage(
      type: DhtMessageType.store,
      senderId: nodeId,
      data: data,
    );

    final response = await _sendRpc(peer, message);
    return response?.success == true;
  }

  /// 发送 FIND_VALUE RPC
  Future<DhtData?> _sendFindValue(DhtPeer peer, DhtId key) async {
    final message = DhtMessage(
      type: DhtMessageType.findValue,
      senderId: nodeId,
      targetId: key,
    );

    final response = await _sendRpc(peer, message);
    return response?.data;
  }

  /// 发送 RPC 并等待响应
  Future<DhtMessage?> _sendRpc(DhtPeer peer, DhtMessage message) async {
    if (_transport == null) {
      debugPrint('[DHT] No transport configured, cannot send RPC to ${peer.id.toHex()}');
      return null;
    }
    return _transport!.sendRpc(peer, message);
  }

  /// 检查是否已收敛
  bool _isConverged(List<DhtPeer> closest, DhtId target) {
    if (closest.isEmpty) return true;

    // 如果最近的节点距离没有变化，认为已收敛
    final closestDistance = closest.first.id.xorDistance(target);
    final myDistance = nodeId.xorDistance(target);

    return closestDistance <= myDistance;
  }

  /// 定期刷新路由表
  Future<void> refresh() async {
    // 刷新每个 bucket
    for (var i = 0; i < 160; i++) {
      final randomId = DhtId.randomInBucket(i);
      await findNode(randomId);
    }
  }

  /// 清理过期数据
  void cleanup() {
    _storage.removeWhere((_, value) => value.isExpired);
  }

  void dispose() {
    _peerFoundController.close();
    _dataReceivedController.close();
  }
}

/// DHT 节点 ID (160-bit)
class DhtId {
  final Uint8List bytes;

  DhtId(this.bytes) : assert(bytes.length == 20);

  /// 生成随机 ID
  factory DhtId.random() {
    final random = Random.secure();
    final bytes = Uint8List(20);
    for (var i = 0; i < 20; i++) {
      bytes[i] = random.nextInt(256);
    }
    return DhtId(bytes);
  }

  /// 生成指定 bucket 范围内的随机 ID
  /// 生成与当前节点在 bucket 位有不同前缀的随机 ID
  factory DhtId.randomInBucket(int bucket) {
    final bytes = Uint8List(20);
    final random = Random.secure();

    // bucket 0-159 对应从最高位开始的公共前缀长度
    final byteIndex = bucket ~/ 8;
    final bitIndex = 7 - (bucket % 8);

    for (var i = 0; i < 20; i++) {
      if (i < byteIndex) {
        bytes[i] = random.nextInt(256);
      } else if (i == byteIndex) {
        // 在特定位翻转，保留更高位
        final mask = 1 << bitIndex;
        bytes[i] = random.nextInt(256) & ~mask | (random.nextBool() ? mask : 0);
      } else {
        bytes[i] = random.nextInt(256);
      }
    }
    return DhtId(bytes);
  }

  /// 从字符串解析
  factory DhtId.fromHex(String hex) {
    final bytes = Uint8List(20);
    for (var i = 0; i < 20; i++) {
      bytes[i] = int.parse(hex.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return DhtId(bytes);
  }

  /// XOR 距离
  BigInt xorDistance(DhtId other) {
    var result = BigInt.zero;
    for (var i = 0; i < 20; i++) {
      final xor = bytes[i] ^ other.bytes[i];
      result = (result << 8) + BigInt.from(xor);
    }
    return result;
  }

  /// 计算公共前缀长度 (bucket 索引)
  int commonPrefixLength(DhtId other) {
    for (var i = 0; i < 20; i++) {
      final xor = bytes[i] ^ other.bytes[i];
      if (xor != 0) {
        return i * 8 + _leadingZeros(xor);
      }
    }
    return 160;
  }

  int _leadingZeros(int byte) {
    for (var i = 7; i >= 0; i--) {
      if ((byte & (1 << i)) != 0) {
        return 7 - i;
      }
    }
    return 8;
  }

  String toHex() {
    return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  }

  @override
  String toString() => toHex();
}

/// DHT 路由表 (K-Buckets)
class DhtRoutingTable {
  final int k;
  final DhtId _localNodeId;
  final List<_KBucket> _buckets = [];

  DhtRoutingTable({required this.k, required DhtId localNodeId})
      : _localNodeId = localNodeId {
    // 初始化 160 个 bucket
    for (var i = 0; i < 160; i++) {
      _buckets.add(_KBucket(k: k));
    }
  }

  /// 添加节点
  void add(DhtPeer peer) {
    // Bucket index = common prefix length between local node ID and peer ID
    final bucketIndex = _localNodeId.commonPrefixLength(peer.id);
    _buckets[bucketIndex].add(peer);
  }

  /// 移除节点
  void remove(DhtPeer peer) {
    final bucketIndex = _localNodeId.commonPrefixLength(peer.id);
    _buckets[bucketIndex].remove(peer);
  }

  /// 查找最近的节点
  List<DhtPeer> findClosest(DhtId target, int count) {
    final all = <DhtPeer>[];

    for (final bucket in _buckets) {
      all.addAll(bucket.peers);
    }

    all.sort((a, b) =>
      a.id.xorDistance(target).compareTo(b.id.xorDistance(target)));

    return all.take(count).toList();
  }
}

/// K-Bucket
class _KBucket {
  final int k;
  final List<DhtPeer> peers = [];

  _KBucket({required this.k});

  void add(DhtPeer peer) {
    if (peers.length < k) {
      peers.add(peer);
    }
  }

  void remove(DhtPeer peer) {
    peers.removeWhere((p) => p.id.toHex() == peer.id.toHex());
  }
}

/// DHT 节点信息
class DhtPeer {
  final DhtId id;
  final String address;
  final int? port;
  final DhtDataChannel? channel;

  DhtPeer({
    required this.id,
    required this.address,
    this.port,
    this.channel,
  });

  Map<String, dynamic> toJson() => {
    'id': id.toHex(),
    'address': address,
    'port': port,
  };

  factory DhtPeer.fromJson(Map<String, dynamic> json) => DhtPeer(
    id: DhtId.fromHex(json['id'] as String),
    address: json['address'] as String,
    port: json['port'] as int?,
  );
}

/// DHT 数据通道抽象
abstract class DhtDataChannel {
  Stream<String> get messages;
  void send(String data);
}

/// DHT 数据
class DhtData {
  final DhtId key;
  final dynamic value;
  final DateTime timestamp;
  final Duration ttl;

  DhtData({
    required this.key,
    required this.value,
    required this.timestamp,
    required this.ttl,
  });

  bool get isExpired => DateTime.now().difference(timestamp) > ttl;

  Map<String, dynamic> toJson() => {
    'key': key.toHex(),
    'value': value,
    'timestamp': timestamp.millisecondsSinceEpoch,
    'ttl': ttl.inSeconds,
  };

  factory DhtData.fromJson(Map<String, dynamic> json) => DhtData(
    key: DhtId.fromHex(json['key'] as String),
    value: json['value'],
    timestamp: DateTime.fromMillisecondsSinceEpoch(json['timestamp'] as int),
    ttl: Duration(seconds: json['ttl'] as int),
  );
}

/// DHT 消息类型
enum DhtMessageType {
  ping,
  pong,
  findNode,
  findValue,
  store,
}

/// DHT 消息
class DhtMessage {
  final DhtMessageType type;
  final DhtId senderId;
  final DhtId? targetId;
  final DhtData? data;
  final List<DhtPeer>? peers;
  final bool? success;
  final String? requestId;

  DhtMessage({
    required this.type,
    required this.senderId,
    this.targetId,
    this.data,
    this.peers,
    this.success,
    this.requestId,
  });

  Map<String, dynamic> toJson() => {
    'type': type.name,
    'senderId': senderId.toHex(),
    if (targetId != null) 'targetId': targetId!.toHex(),
    if (data != null) 'data': data!.toJson(),
    if (peers != null) 'peers': peers!.map((p) => p.toJson()).toList(),
    if (success != null) 'success': success,
    if (requestId != null) 'requestId': requestId,
  };

  factory DhtMessage.fromJson(Map<String, dynamic> json) => DhtMessage(
    type: DhtMessageType.values.firstWhere((e) => e.name == json['type']),
    senderId: DhtId.fromHex(json['senderId'] as String),
    targetId: json['targetId'] != null ? DhtId.fromHex(json['targetId'] as String) : null,
    data: json['data'] != null ? DhtData.fromJson(json['data']) : null,
    peers: json['peers'] != null
      ? (json['peers'] as List).map((p) => DhtPeer.fromJson(p)).toList()
      : null,
    success: json['success'] as bool?,
    requestId: json['requestId'] as String?,
  );
}

/// 存储值包装
class _DhtValue {
  final DhtData data;
  final DateTime lastRefresh;

  _DhtValue({required this.data, required this.lastRefresh});

  bool get isExpired => data.isExpired;
}

/// DHT 传输层抽象
/// 负责节点间的 RPC 通信
abstract class DhtTransport {
  /// 向指定节点发送 RPC 并等待响应
  Future<DhtMessage?> sendRpc(DhtPeer peer, DhtMessage message);

  /// 设置接收消息处理器
  void setMessageHandler(void Function(DhtMessage) handler);

  /// 关闭传输
  void close();
}

/// 使用 Bridge 服务器 WebSocket 的 DHT 传输层
/// 通过 Bridge 服务器中继 DHT 消息，实现真正的去中心化通信
class BridgeDhtTransport implements DhtTransport {
  final String bridgeUrl;
  final DhtId localNodeId;

  WebSocketChannel? _channel;
  bool _connected = false;
  final _pendingRequests = <String, Completer<DhtMessage?>>{};
  void Function(DhtMessage)? _messageHandler;

  BridgeDhtTransport({
    required this.bridgeUrl,
    required this.localNodeId,
  });

  bool get isConnected => _connected;

  Future<void> connect() async {
    try {
      _channel = WebSocketChannel.connect(Uri.parse(bridgeUrl));
      _connected = true;

      _channel!.stream.listen(
        (data) {
          try {
            final json = jsonDecode(data as String) as Map<String, dynamic>;
            if (json['type'] == 'dht_message') {
              final msg = DhtMessage.fromJson(json['data'] as Map<String, dynamic>);
              // 如果是响应，检查 pending 请求
              if (msg.requestId != null && _pendingRequests.containsKey(msg.requestId)) {
                _pendingRequests[msg.requestId!]!.complete(msg);
                _pendingRequests.remove(msg.requestId);
              } else {
                // 否则交给消息处理器
                _messageHandler?.call(msg);
              }
            }
          } catch (e) {
            debugPrint('[DHT-Transport] Parse error: $e');
          }
        },
        onError: (e) {
          debugPrint('[DHT-Transport] WebSocket error: $e');
          _connected = false;
        },
        onDone: () {
          _connected = false;
        },
      );

      debugPrint('[DHT-Transport] Connected to $bridgeUrl');
    } catch (e) {
      debugPrint('[DHT-Transport] Connection failed: $e');
      _connected = false;
    }
  }

  @override
  Future<DhtMessage?> sendRpc(DhtPeer peer, DhtMessage message) async {
    if (!_connected || _channel == null) {
      debugPrint('[DHT-Transport] Not connected');
      return null;
    }

    final requestId = '${localNodeId.toHex()}_${DateTime.now().microsecondsSinceEpoch}';
    final request = message.toJson();
    request['requestId'] = requestId;
    request['targetNodeId'] = peer.id.toHex();

    final completer = Completer<DhtMessage?>();
    _pendingRequests[requestId] = completer;

    final json = jsonEncode({
      'type': 'dht_message',
      'data': request,
    });
    _channel!.sink.add(json);

    // 超时 5 秒
    await Future.delayed(const Duration(seconds: 5), () {
      if (!completer.isCompleted) {
        completer.complete(null);
        _pendingRequests.remove(requestId);
      }
    });

    return completer.future;
  }

  @override
  void setMessageHandler(void Function(DhtMessage) handler) {
    _messageHandler = handler;
  }

  @override
  void close() {
    for (final completer in _pendingRequests.values) {
      completer.complete(null);
    }
    _pendingRequests.clear();
    _channel?.sink.close();
    _connected = false;
  }
}
