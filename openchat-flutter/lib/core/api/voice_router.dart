/// P2P voice routing layer — multi-hop path discovery + fault recovery
/// Each phone builds a routing table via gossip and routes audio through
/// intermediate peers when direct connection is unavailable.

import 'dart:async';
import 'dart:collection';

class RouteEntry {
  final String targetPeerId;
  String nextHopPeerId;
  int latencyMs;
  int failures;
  DateTime lastSeen;

  RouteEntry({
    required this.targetPeerId,
    required this.nextHopPeerId,
    this.latencyMs = 999,
    this.failures = 0,
    DateTime? lastSeen,
  }) : lastSeen = lastSeen ?? DateTime.now();

  bool get isStale => DateTime.now().difference(lastSeen).inSeconds > 60;
  bool get isDead => failures >= 3;
}

class VoiceRouter {
  final String _myPeerId;
  final Map<String, RouteEntry> _routes = {};
  final _routeCtrl = StreamController<Map<String, RouteEntry>>.broadcast();
  Stream<Map<String, RouteEntry>> get routeUpdates => _routeCtrl.stream;

  // Pending ACKs for in-flight audio packets
  final _pendingAcks = HashMap<String, Completer<bool>>();

  VoiceRouter(this._myPeerId);

  /// Build audio data packet with routing header
  Map<String, dynamic> buildAudioPacket(String targetPeerId, String payload) {
    final path = _resolvePath(targetPeerId);
    return {
      'type': 'signaling_message',
      'data': {
        'action': 'audio-data',
        'fromPeerId': _myPeerId,
        'toPeerId': targetPeerId,
        'path': path,
        'payload': payload,
        'packetId': '${DateTime.now().millisecondsSinceEpoch}-${_myPeerId}',
      },
    };
  }

  /// Resolve the path to target peer
  List<String> _resolvePath(String target) {
    // If we have a direct route, try it first
    if (_routes.containsKey(target)) {
      final route = _routes[target]!;
      if (!route.isStale && !route.isDead) {
        return [target]; // Direct
      }
    }
    // Find best indirect route
    RouteEntry? best;
    for (final e in _routes.values) {
      if (e.isDead || e.isStale) continue;
      if (e.targetPeerId == target) continue;
      if (best == null || e.failures < best.failures) best = e;
    }
    if (best != null) return [best.nextHopPeerId, target];
    return [target]; // Fallback: try direct
  }

  /// Handle incoming audio-data packet
  Map<String, dynamic>? handleIncoming(Map<String, dynamic> data) {
    final path = List<String>.from(data['path'] ?? []);
    final from = data['fromPeerId'] as String?;
    final target = data['toPeerId'] as String?;

    // Update routing table from sender
    if (from != null) {
      _updateRoute(from, path.isNotEmpty ? path.first : from, 0);
    }

    // Check if we are the final destination
    if (target == _myPeerId) return data;

    // Forward to next hop
    if (path.length <= 1) return null;
    path.removeAt(0);
    data['path'] = path;
    return data;
  }

  void _updateRoute(String target, String nextHop, int latency) {
    if (_routes.containsKey(target)) {
      final r = _routes[target]!;
      r.nextHopPeerId = nextHop;
      r.latencyMs = (r.latencyMs + latency) ~/ 2;
      r.lastSeen = DateTime.now();
    } else {
      _routes[target] = RouteEntry(targetPeerId: target, nextHopPeerId: nextHop, latencyMs: latency);
    }
    _routeCtrl.add(Map.from(_routes));
  }

  /// Report a failed delivery for a route
  void reportFailure(String target) {
    if (_routes.containsKey(target)) {
      _routes[target]!.failures++;
      _routes[target]!.lastSeen = DateTime.now();
    }
    _routeCtrl.add(Map.from(_routes));
  }

  /// Report successful delivery
  void reportSuccess(String target, int latencyMs) {
    if (_routes.containsKey(target)) {
      final r = _routes[target]!;
      r.failures = 0;
      r.latencyMs = latencyMs;
      r.lastSeen = DateTime.now();
    }
    _routeCtrl.add(Map.from(_routes));
  }

  /// Gossip exchange: return our routing table for syncing
  List<Map<String, dynamic>> getGossipPayload() {
    return _routes.entries
      .where((e) => !e.value.isStale)
      .map((e) => {
        'targetPeerId': e.value.targetPeerId,
        'nextHopPeerId': e.value.nextHopPeerId,
        'latencyMs': e.value.latencyMs,
        'failures': e.value.failures,
      }).toList();
  }

  /// Gossip exchange: merge received routing info
  void mergeGossip(List<Map<String, dynamic>> gossip) {
    for (final g in gossip) {
      final target = g['targetPeerId'] as String;
      final nextHop = g['nextHopPeerId'] as String;
      if (target == _myPeerId) continue;
      if (!_routes.containsKey(target)) {
        _routes[target] = RouteEntry(targetPeerId: target, nextHopPeerId: nextHop);
      }
    }
  }

  void dispose() {
    _routeCtrl.close();
  }
}
