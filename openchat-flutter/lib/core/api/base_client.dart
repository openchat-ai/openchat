import 'dart:async';
import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

/// ===== base_client.dart =====
class BaseClient {
  late final Dio _dio;
  final String baseUrl;
  String? _token;

  BaseClient({required this.baseUrl, String? token, Dio? dio}) {
    _token = token;
    _dio = dio ?? _createDio();
  }

  Dio _createDio() {
    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json', if (_token != null) 'Authorization': 'Bearer $_token'},
    ));
    dio.interceptors.add(InterceptorsWrapper(onError: (error, handler) async {
      if (error.response?.statusCode == 429) {
        final data = error.response?.data as Map<String, dynamic>?;
        final retryAfter = data?['retryAfter'] as int?;
        if (retryAfter != null) {
          await Future.delayed(Duration(seconds: retryAfter));
          final options = error.requestOptions;
          options.headers['Authorization'] = 'Bearer $_token';
          try { handler.resolve(await _dio.fetch(options)); return; } catch (e) { handler.reject(error); return; }
        }
      }
      handler.next(error);
    }));
    return dio;
  }

  void setToken(String? token) { _token = token; }
  Dio get dio => _dio;
}

/// ===== bridge_ws_client.dart =====
enum WsConnectionState { disconnected, connecting, connected, reconnecting }

class BridgeWsMessage {
  final String type;
  final Map<String, dynamic> data;
  final String? sessionId;
  BridgeWsMessage({required this.type, required this.data, this.sessionId});
  factory BridgeWsMessage.fromJson(Map<String, dynamic> json) => BridgeWsMessage(
    type: json['type'] as String? ?? '', data: json['data'] as Map<String, dynamic>? ?? {}, sessionId: json['sessionId'] as String?,
  );
}

class WsConnectionInfo {
  final WsConnectionState state;
  final int reconnectAttempt;
  final int? nextRetrySeconds;
  WsConnectionInfo({required this.state, this.reconnectAttempt = 0, this.nextRetrySeconds});
}

class BridgeWsClient {
  WebSocketChannel? _channel;
  String _host;
  int _port;
  String? _token;
  WsConnectionState _state = WsConnectionState.disconnected;
  bool _reconnect = true;
  Timer? _reconnectTimer;
  Timer? _heartbeatTimer;
  int _reconnectAttempt = 0;
  static const int _maxReconnectAttempts = 10;
  static const int _maxReconnectDelay = 30;
  static const int _heartbeatInterval = 25;
  String? _peerId;
  final _messageController = StreamController<BridgeWsMessage>.broadcast();
  final _stateController = StreamController<WsConnectionInfo>.broadcast();

  Stream<BridgeWsMessage> get messages => _messageController.stream;
  Stream<WsConnectionInfo> get connectionState => _stateController.stream;
  bool get isConnected => _state == WsConnectionState.connected;
  WsConnectionState get state => _state;
  String? get peerId => _peerId;

  BridgeWsClient({String host = 'localhost', int port = 3800, String? token}) : _host = host, _port = port, _token = token;

  void configure({String? host, int? port, String? token}) { _host = host ?? _host; _port = port ?? _port; _token = token ?? _token; }

  Future<void> connect() async { _reconnect = true; _reconnectAttempt = 0; _reconnectTimer?.cancel(); await _doConnect(); }

  Future<void> _doConnect() async {
    _setState(WsConnectionState.connecting);
    try {
      var uriStr = 'ws://$_host:$_port/ws';
      if (_token != null && _token!.isNotEmpty) uriStr += '?token=$_token';
      _channel = WebSocketChannel.connect(Uri.parse(uriStr));
      await _channel!.ready;
      _reconnectAttempt = 0;
      _setState(WsConnectionState.connected);
      _startHeartbeat();
      _channel!.stream.listen(_onMessage, onError: _onError, onDone: _onDone);
    } catch (e) { _state = WsConnectionState.disconnected; _setState(WsConnectionState.disconnected); _scheduleReconnect(); }
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(Duration(seconds: _heartbeatInterval), (_) {
      if (_channel != null && _state == WsConnectionState.connected) { try { _channel!.sink.add(jsonEncode({'type': 'ping'})); } catch (_) { _onError('heartbeat failed'); } }
    });
  }

  void _setState(WsConnectionState newState) {
    _state = newState;
    _stateController.add(WsConnectionInfo(state: newState, reconnectAttempt: _reconnectAttempt, nextRetrySeconds: _reconnectTimer != null && newState == WsConnectionState.reconnecting ? (_reconnectAttempt * 2).clamp(1, _maxReconnectDelay) : null));
  }

  void _onMessage(dynamic data) {
    try {
      final text = data as String;
      if (text == 'pong') return;
      final json = jsonDecode(text) as Map<String, dynamic>;
      final msg = BridgeWsMessage.fromJson(json);
      if (msg.type == 'bridge_handshake') { _peerId = msg.data['peerId'] as String?; return; }
      _messageController.add(msg);
    } catch (_) {}
  }

  void _onError(Object error) { _heartbeatTimer?.cancel(); _setState(WsConnectionState.reconnecting); _scheduleReconnect(); }
  void _onDone() { _heartbeatTimer?.cancel(); _setState(WsConnectionState.reconnecting); _scheduleReconnect(); }

  void _scheduleReconnect() {
    if (!_reconnect) return;
    if (_reconnectAttempt >= _maxReconnectAttempts) { _setState(WsConnectionState.disconnected); return; }
    _reconnectTimer?.cancel();
    _reconnectAttempt++;
    final delay = (_reconnectAttempt * 2).clamp(1, _maxReconnectDelay);
    _reconnectTimer = Timer(Duration(seconds: delay), _doConnect);
    _setState(WsConnectionState.reconnecting);
  }

  void sendMessage(String text, {String? sessionId, bool debugMode = false}) {
    if (_channel == null || !isConnected) return;
    _channel!.sink.add(jsonEncode({'type': debugMode ? 'chat_debug' : 'chat', 'data': {'message': text, 'sessionId': sessionId}, 'sessionId': sessionId}));
  }

  void sendToPeer(String targetPeerId, String text, {String? sessionId}) {
    if (_channel == null || !isConnected) return;
    _channel!.sink.add(jsonEncode({'type': 'message', 'data': {'message': text, 'to': targetPeerId}}));
  }

  void sendJson(Map<String, dynamic> json) { if (_channel == null || !isConnected) return; _channel!.sink.add(jsonEncode(json)); }

  void disconnect() { _reconnect = false; _reconnectTimer?.cancel(); _heartbeatTimer?.cancel(); _channel?.sink.close(); _setState(WsConnectionState.disconnected); }
  void dispose() { disconnect(); _messageController.close(); _stateController.close(); }
}

/// ===== agent_client.dart =====
class AgentClient extends BaseClient {
  AgentClient({required super.baseUrl, super.token});

  Future<Agent> createAgent({required String role, String? name, String? task, List<String>? capabilities, int? residentId}) async {
    final response = await dio.post('$baseUrl/api/v1/agents', data: {'role': role, 'name': name, 'task': task, 'capabilities': capabilities, if (residentId != null) 'residentId': residentId});
    return Agent.fromJson(response.data);
  }

  Future<List<Agent>> getAgents({String? status, int? residentId}) async {
    final params = <String, dynamic>{};
    if (status != null) params['status'] = status;
    if (residentId != null) params['residentId'] = residentId;
    final response = await dio.get('$baseUrl/api/v1/agents', queryParameters: params.isNotEmpty ? params : null);
    return (response.data['agents'] as List).map((j) => Agent.fromJson(j)).toList();
  }

  Future<Agent> getAgentDetails(String id) async { final response = await dio.get('$baseUrl/api/v1/agents/$id'); return Agent.fromJson(response.data); }
  Future<AgentFeedback> getAgentFeedback(String id) async { final response = await dio.get('$baseUrl/api/v1/agents/$id/feedback'); return AgentFeedback.fromJson(response.data); }
  Future<void> terminateAgent(String id) async { await dio.delete('$baseUrl/api/v1/agents/$id'); }
}

/// ===== decisions_client.dart =====
class DecisionsClient extends BaseClient {
  DecisionsClient({required super.baseUrl, super.token});

  Future<Decision> createDecision({required String type, required List<String> feedbackIds, String? reasoning, Map<String, dynamic>? metadata}) async {
    final response = await dio.post('$baseUrl/api/v1/decisions', data: {'type': type, 'feedbackIds': feedbackIds, 'reasoning': reasoning, 'metadata': metadata});
    return Decision.fromJson(response.data);
  }

  Future<DecisionList> getDecisions({String? status, String? type, int limit = 50}) async {
    final response = await dio.get('$baseUrl/api/v1/decisions', queryParameters: {'status': status, 'type': type, 'limit': limit});
    return DecisionList.fromJson(response.data);
  }

  Future<Decision> getDecision(String id) async { final response = await dio.get('$baseUrl/api/v1/decisions/$id'); return Decision.fromJson(response.data); }
  Future<Decision> updateDecision(String id, {String? status, String? executedAt}) async {
    final response = await dio.patch('$baseUrl/api/v1/decisions/$id', data: {'status': status, 'executedAt': executedAt});
    return Decision.fromJson(response.data);
  }
}

class Decision {
  final String id, type, reasoning, status, createdAt;
  final List<String> feedbackIds;
  final Map<String, dynamic> metadata;
  final String? executedAt;
  Decision({required this.id, required this.type, required this.feedbackIds, required this.reasoning, required this.metadata, required this.status, required this.createdAt, this.executedAt});
  factory Decision.fromJson(Map<String, dynamic> json) => Decision(
    id: json['id'] ?? '', type: json['type'] ?? '', feedbackIds: List<String>.from(json['feedbackIds'] ?? []),
    reasoning: json['reasoning'] ?? '', metadata: Map<String, dynamic>.from(json['metadata'] ?? {}),
    status: json['status'] ?? '', createdAt: json['createdAt'] ?? '', executedAt: json['executedAt'],
  );
}

class DecisionList {
  final List<Decision> decisions; final int total;
  DecisionList({required this.decisions, required this.total});
  factory DecisionList.fromJson(Map<String, dynamic> json) => DecisionList(decisions: (json['decisions'] as List? ?? []).map((d) => Decision.fromJson(d)).toList(), total: json['total'] ?? 0);
}

/// ===== feedback_client.dart =====
class FeedbackClient extends BaseClient {
  FeedbackClient({required super.baseUrl, super.token});

  Future<AggregatedFeedback> aggregateFeedback({required List<String> agentIds, AggregateOptions? options}) async {
    final response = await dio.post('$baseUrl/api/v1/feedback/aggregate', data: {'agentIds': agentIds, 'options': options?.toJson() ?? {}});
    return AggregatedFeedback.fromJson(response.data);
  }
}

class AggregateOptions {
  final bool normalize, deduplicate, prioritize;
  AggregateOptions({this.normalize = true, this.deduplicate = true, this.prioritize = true});
  Map<String, dynamic> toJson() => {'normalize': normalize, 'deduplicate': deduplicate, 'prioritize': prioritize};
  factory AggregateOptions.fromJson(Map<String, dynamic> json) => AggregateOptions(normalize: json['normalize'] ?? true, deduplicate: json['deduplicate'] ?? true, prioritize: json['prioritize'] ?? true);
}

class AggregatedFeedback {
  final String id; final List<String> agentIds; final String timestamp; final int feedbackCount;
  final List<FeedbackItem> feedback; final FeedbackSummary summary; final AggregateOptions options;
  AggregatedFeedback({required this.id, required this.agentIds, required this.timestamp, required this.feedbackCount, required this.feedback, required this.summary, required this.options});
  factory AggregatedFeedback.fromJson(Map<String, dynamic> json) => AggregatedFeedback(
    id: json['id'] ?? '', agentIds: List<String>.from(json['agentIds'] ?? []), timestamp: json['timestamp'] ?? '',
    feedbackCount: json['feedbackCount'] ?? 0, feedback: (json['feedback'] as List? ?? []).map((f) => FeedbackItem.fromJson(f)).toList(),
    summary: FeedbackSummary.fromJson(json['summary'] ?? {}), options: AggregateOptions.fromJson(json['options'] ?? {}),
  );
}

class FeedbackItem {
  final String? agentId, agentRole, category, priority, message;
  final Map<String, dynamic>? data;
  FeedbackItem({this.agentId, this.agentRole, this.category, this.priority, this.message, this.data});
  factory FeedbackItem.fromJson(Map<String, dynamic> json) => FeedbackItem(agentId: json['agentId'], agentRole: json['agentRole'], category: json['category'], priority: json['priority'], message: json['message'], data: json['data']);
}

class FeedbackSummary {
  final int total; final Map<String, int> byPriority, byCategory;
  FeedbackSummary({required this.total, required this.byPriority, required this.byCategory});
  factory FeedbackSummary.fromJson(Map<String, dynamic> json) => FeedbackSummary(total: json['total'] ?? 0, byPriority: Map<String, int>.from(json['byPriority'] ?? {}), byCategory: Map<String, int>.from(json['byCategory'] ?? {}));
}

/// ===== metrics_client.dart =====
class MetricsClient extends BaseClient {
  MetricsClient({required super.baseUrl, super.token});

  Future<MetricsSummary> getSummary() async { final response = await dio.get('$baseUrl/api/v1/metrics'); return MetricsSummary.fromJson(response.data); }
  Future<MetricsDetailed> getDetailed() async { final response = await dio.get('$baseUrl/api/v1/metrics/detailed'); return MetricsDetailed.fromJson(response.data); }
  Future<EndpointMetrics> getEndpoints() async { final response = await dio.get('$baseUrl/api/v1/metrics/endpoints'); return EndpointMetrics.fromJson(response.data); }
  Future<ErrorMetrics> getErrors() async { final response = await dio.get('$baseUrl/api/v1/metrics/errors'); return ErrorMetrics.fromJson(response.data); }
  Future<ResetResult> reset() async { final response = await dio.post('$baseUrl/api/v1/metrics/reset'); return ResetResult.fromJson(response.data); }
}

class MetricsSummary {
  final int totalRequests, activeConnections;
  final double avgResponseTime;
  final Map<String, int> requestsByMethod, statusCodes;
  MetricsSummary({required this.totalRequests, required this.avgResponseTime, required this.activeConnections, required this.requestsByMethod, required this.statusCodes});
  factory MetricsSummary.fromJson(Map<String, dynamic> json) => MetricsSummary(
    totalRequests: json['totalRequests'] ?? 0, avgResponseTime: (json['avgResponseTime'] ?? 0).toDouble(),
    activeConnections: json['activeConnections'] ?? 0, requestsByMethod: Map<String, int>.from(json['requestsByMethod'] ?? {}),
    statusCodes: Map<String, int>.from(json['statusCodes'] ?? {}),
  );
}

class MetricsDetailed {
  final MetricsSummary summary; final List<EndpointStat> endpoints; final ErrorStats errors; final Map<String, dynamic> performance;
  MetricsDetailed({required this.summary, required this.endpoints, required this.errors, required this.performance});
  factory MetricsDetailed.fromJson(Map<String, dynamic> json) => MetricsDetailed(
    summary: MetricsSummary.fromJson(json['summary'] ?? {}),
    endpoints: (json['endpoints'] as List? ?? []).map((e) => EndpointStat.fromJson(e)).toList(),
    errors: ErrorStats.fromJson(json['errors'] ?? {}), performance: Map<String, dynamic>.from(json['performance'] ?? {}),
  );
}

class EndpointStat {
  final String path, method; final int count, errorCount; final double avgResponseTime;
  EndpointStat({required this.path, required this.method, required this.count, required this.avgResponseTime, required this.errorCount});
  factory EndpointStat.fromJson(Map<String, dynamic> json) => EndpointStat(
    path: json['path'] ?? '', method: json['method'] ?? '', count: json['count'] ?? 0,
    avgResponseTime: (json['avgResponseTime'] ?? 0).toDouble(), errorCount: json['errorCount'] ?? 0,
  );
}

class EndpointMetrics {
  final List<EndpointStat> endpoints; final int total;
  EndpointMetrics({required this.endpoints, required this.total});
  factory EndpointMetrics.fromJson(Map<String, dynamic> json) => EndpointMetrics(endpoints: (json['endpoints'] as List? ?? []).map((e) => EndpointStat.fromJson(e)).toList(), total: json['total'] ?? 0);
}

class ErrorStats {
  final Map<String, int> byType; final List<RecentError> recent;
  ErrorStats({required this.byType, required this.recent});
  factory ErrorStats.fromJson(Map<String, dynamic> json) => ErrorStats(byType: Map<String, int>.from(json['byType'] ?? {}), recent: (json['recent'] as List? ?? []).map((e) => RecentError.fromJson(e)).toList());
}

class RecentError {
  final String type, message, endpoint, timestamp;
  RecentError({required this.type, required this.message, required this.endpoint, required this.timestamp});
  factory RecentError.fromJson(Map<String, dynamic> json) => RecentError(type: json['type'] ?? '', message: json['message'] ?? '', endpoint: json['endpoint'] ?? '', timestamp: json['timestamp'] ?? '');
}

class ErrorMetrics {
  final Map<String, int> byType; final List<RecentError> recent;
  ErrorMetrics({required this.byType, required this.recent});
  factory ErrorMetrics.fromJson(Map<String, dynamic> json) => ErrorMetrics(byType: Map<String, int>.from(json['byType'] ?? {}), recent: (json['recent'] as List? ?? []).map((e) => RecentError.fromJson(e)).toList());
}

class ResetResult {
  final String status, timestamp;
  ResetResult({required this.status, required this.timestamp});
  factory ResetResult.fromJson(Map<String, dynamic> json) => ResetResult(status: json['status'] ?? '', timestamp: json['timestamp'] ?? '');
}

/// ===== p2p_client.dart =====
class P2PClient extends BaseClient {
  P2PClient({required super.baseUrl, super.token});

  Future<P2PMessage> sendMessage({required String type, String? targetPeerId, required Map<String, dynamic> payload, String priority = 'NORMAL'}) async {
    final response = await dio.post('$baseUrl/api/v1/p2p/messages', data: {'type': type, 'targetPeerId': targetPeerId, 'payload': payload, 'priority': priority});
    return P2PMessage.fromJson(response.data);
  }

  Future<P2PMessage> getMessage(String id) async { final response = await dio.get('$baseUrl/api/v1/p2p/messages/$id'); return P2PMessage.fromJson(response.data); }
  Future<InboxResult> getInbox({String? status, int limit = 50}) async { final response = await dio.get('$baseUrl/api/v1/p2p/inbox', queryParameters: {'status': status, 'limit': limit}); return InboxResult.fromJson(response.data); }
  Future<PeerList> getPeers() async { final response = await dio.get('$baseUrl/api/v1/p2p/peers'); return PeerList.fromJson(response.data); }
  Future<Peer> connectPeer(String id, String peerAddress) async { final response = await dio.post('$baseUrl/api/v1/p2p/peers/$id/connect', data: {'peerAddress': peerAddress}); return Peer.fromJson(response.data); }
  Future<Peer> disconnectPeer(String id) async { final response = await dio.delete('$baseUrl/api/v1/p2p/peers/$id'); return Peer.fromJson(response.data); }
  Future<P2PStats> getStats() async { final response = await dio.get('$baseUrl/api/v1/p2p/stats'); return P2PStats.fromJson(response.data); }
  Future<P2PConfigResult> updateConfig({String? encryption, bool? discoveryEnabled, int? maxPeers}) async { final response = await dio.put('$baseUrl/api/v1/p2p/config', data: {'encryption': encryption, 'discoveryEnabled': discoveryEnabled, 'maxPeers': maxPeers}); return P2PConfigResult.fromJson(response.data); }
}

class P2PMessage {
  final String id, type, sourcePeerId, priority, status, createdAt;
  final String? targetPeerId, deliveredAt;
  final Map<String, dynamic> payload;
  P2PMessage({required this.id, required this.type, required this.sourcePeerId, this.targetPeerId, required this.payload, required this.priority, required this.status, required this.createdAt, this.deliveredAt});
  factory P2PMessage.fromJson(Map<String, dynamic> json) => P2PMessage(
    id: json['id'] ?? '', type: json['type'] ?? '', sourcePeerId: json['sourcePeerId'] ?? '',
    targetPeerId: json['targetPeerId'], payload: Map<String, dynamic>.from(json['payload'] ?? {}),
    priority: json['priority'] ?? 'NORMAL', status: json['status'] ?? '', createdAt: json['createdAt'] ?? '', deliveredAt: json['deliveredAt'],
  );
}

class InboxResult { final List<P2PMessage> messages; final int total; InboxResult({required this.messages, required this.total}); factory InboxResult.fromJson(Map<String, dynamic> json) => InboxResult(messages: (json['messages'] as List? ?? []).map((m) => P2PMessage.fromJson(m)).toList(), total: json['total'] ?? 0); }
class Peer { final String id, status; final String? address, connectedAt, disconnectedAt; Peer({required this.id, this.address, required this.status, this.connectedAt, this.disconnectedAt}); factory Peer.fromJson(Map<String, dynamic> json) => Peer(id: json['id'] ?? '', address: json['address'], status: json['status'] ?? '', connectedAt: json['connectedAt'], disconnectedAt: json['disconnectedAt']); }
class PeerList { final List<Peer> peers; final int total; PeerList({required this.peers, required this.total}); factory PeerList.fromJson(Map<String, dynamic> json) => PeerList(peers: (json['peers'] as List? ?? []).map((p) => Peer.fromJson(p)).toList(), total: json['total'] ?? 0); }
class P2PStats { final PeerStats peers; final MessageStats messages; final P2PConfig config; P2PStats({required this.peers, required this.messages, required this.config}); factory P2PStats.fromJson(Map<String, dynamic> json) => P2PStats(peers: PeerStats.fromJson(json['peers'] ?? {}), messages: MessageStats.fromJson(json['messages'] ?? {}), config: P2PConfig.fromJson(json['config'] ?? {})); }
class PeerStats { final int total, connected, connecting; PeerStats({required this.total, required this.connected, required this.connecting}); factory PeerStats.fromJson(Map<String, dynamic> json) => PeerStats(total: json['total'] ?? 0, connected: json['connected'] ?? 0, connecting: json['connecting'] ?? 0); }
class MessageStats { final int total, pending, delivered; MessageStats({required this.total, required this.pending, required this.delivered}); factory MessageStats.fromJson(Map<String, dynamic> json) => MessageStats(total: json['total'] ?? 0, pending: json['pending'] ?? 0, delivered: json['delivered'] ?? 0); }
class P2PConfig { final String encryption; final bool discoveryEnabled; final int maxPeers; P2PConfig({required this.encryption, required this.discoveryEnabled, required this.maxPeers}); factory P2PConfig.fromJson(Map<String, dynamic> json) => P2PConfig(encryption: json['encryption'] ?? 'TLS', discoveryEnabled: json['discoveryEnabled'] ?? true, maxPeers: json['maxPeers'] ?? 50); }
class P2PConfigResult { final P2PConfig config; final String updatedAt; P2PConfigResult({required this.config, required this.updatedAt}); factory P2PConfigResult.fromJson(Map<String, dynamic> json) => P2PConfigResult(config: P2PConfig.fromJson(json['config'] ?? {}), updatedAt: json['updatedAt'] ?? ''); }

/// ===== resident_client.dart =====
class ResidentClient extends BaseClient {
  ResidentClient({required super.baseUrl, super.token});

  Future<Resident> createResident({String? name, int? parentId}) async { final response = await dio.post('$baseUrl/api/v1/residents', data: {if (name != null) 'name': name, if (parentId != null) 'parentId': parentId}); return Resident.fromJson(response.data); }
  Future<List<Resident>> getResidents({String? status}) async { final response = await dio.get('$baseUrl/api/v1/residents', queryParameters: status != null ? {'status': status} : null); return (response.data['residents'] as List).map((j) => Resident.fromJson(j)).toList(); }
  Future<Resident> getResidentDetail(int id) async { final response = await dio.get('$baseUrl/api/v1/residents/$id'); return Resident.fromJson(response.data); }
  Future<List<ChildSummary>> getChildren(int id) async { final response = await dio.get('$baseUrl/api/v1/residents/$id/children'); return (response.data['children'] as List).map((j) => ChildSummary.fromJson(j)).toList(); }
  Future<void> deleteResident(int id) async { await dio.delete('$baseUrl/api/v1/residents/$id'); }
  Future<List<FeedItem>> getCommunityFeed({int limit = 20}) async { final response = await dio.get('$baseUrl/api/v1/community/feed', queryParameters: {'limit': limit}); return (response.data['feed'] as List).map((j) => FeedItem.fromJson(j)).toList(); }
}

/// ===== resources_client.dart =====
class ResourcesClient extends BaseClient {
  ResourcesClient({required super.baseUrl, super.token});

  Future<ResourceStatus> getStatus() async { final response = await dio.get('$baseUrl/api/v1/resources/status'); return ResourceStatus.fromJson(response.data); }
  Future<PolicyResult> updatePolicy({String? compression, bool? cacheEnabled, String? networkMode, int? maxStorageMB}) async {
    final response = await dio.put('$baseUrl/api/v1/resources/policy', data: {if (compression != null) 'compression': compression, if (cacheEnabled != null) 'cacheEnabled': cacheEnabled, if (networkMode != null) 'networkMode': networkMode, if (maxStorageMB != null) 'maxStorageMB': maxStorageMB});
    return PolicyResult.fromJson(response.data);
  }
  Future<CleanupResult> cleanup({List<String>? targets}) async { final response = await dio.post('$baseUrl/api/v1/resources/cleanup', data: {'targets': targets ?? ['cache', 'logs', 'temp']}); return CleanupResult.fromJson(response.data); }
}

class ResourceStatus { final NetworkStatus network; final StorageStatus storage; final SystemStatus system; ResourceStatus({required this.network, required this.storage, required this.system}); factory ResourceStatus.fromJson(Map<String, dynamic> json) => ResourceStatus(network: NetworkStatus.fromJson(json['network'] ?? {}), storage: StorageStatus.fromJson(json['storage'] ?? {}), system: SystemStatus.fromJson(json['system'] ?? {})); }
class NetworkStatus { final String mode, compression; final bool cacheEnabled; final int bytesSent, bytesReceived; NetworkStatus({required this.mode, required this.compression, required this.cacheEnabled, required this.bytesSent, required this.bytesReceived}); factory NetworkStatus.fromJson(Map<String, dynamic> json) => NetworkStatus(mode: json['mode'] ?? 'WiFi', compression: json['compression'] ?? 'gzip', cacheEnabled: json['cacheEnabled'] ?? true, bytesSent: json['bytesSent'] ?? 0, bytesReceived: json['bytesReceived'] ?? 0); }
class StorageStatus { final int usedMB, totalMB, cacheMB, logsMB; StorageStatus({required this.usedMB, required this.totalMB, required this.cacheMB, required this.logsMB}); factory StorageStatus.fromJson(Map<String, dynamic> json) => StorageStatus(usedMB: json['usedMB'] ?? 0, totalMB: json['totalMB'] ?? 0, cacheMB: json['cacheMB'] ?? 0, logsMB: json['logsMB'] ?? 0); double get usagePercent => totalMB > 0 ? (usedMB / totalMB) * 100 : 0; }
class SystemStatus { final int cpuPercent, memoryPercent, uptime; SystemStatus({required this.cpuPercent, required this.memoryPercent, required this.uptime}); factory SystemStatus.fromJson(Map<String, dynamic> json) => SystemStatus(cpuPercent: json['cpuPercent'] ?? 0, memoryPercent: json['memoryPercent'] ?? 0, uptime: json['uptime'] ?? 0); String get uptimeFormatted { final hours = uptime ~/ 3600; final minutes = (uptime % 3600) ~/ 60; return '${hours}h ${minutes}m'; } }
class ResourcePolicy { final String compression, networkMode; final bool cacheEnabled, cleanupEnabled; final int maxStorageMB; ResourcePolicy({required this.compression, required this.cacheEnabled, required this.networkMode, required this.maxStorageMB, required this.cleanupEnabled}); factory ResourcePolicy.fromJson(Map<String, dynamic> json) => ResourcePolicy(compression: json['compression'] ?? 'gzip', cacheEnabled: json['cacheEnabled'] ?? true, networkMode: json['networkMode'] ?? 'Auto', maxStorageMB: json['maxStorageMB'] ?? 2048, cleanupEnabled: json['cleanupEnabled'] ?? true); }
class PolicyResult { final ResourcePolicy policy; final String updatedAt; PolicyResult({required this.policy, required this.updatedAt}); factory PolicyResult.fromJson(Map<String, dynamic> json) => PolicyResult(policy: ResourcePolicy.fromJson(json['policy'] ?? {}), updatedAt: json['updatedAt'] ?? ''); }
class CleanupResult { final String? startedAt, completedAt; final Map<String, CleanupTarget> targets; final int totalFreedMB; CleanupResult({required this.startedAt, this.completedAt, required this.targets, required this.totalFreedMB}); factory CleanupResult.fromJson(Map<String, dynamic> json) { final targetsMap = <String, CleanupTarget>{}; (json['targets'] as Map<String, dynamic>? ?? {}).forEach((k, v) => targetsMap[k] = CleanupTarget.fromJson(v)); return CleanupResult(startedAt: json['startedAt'] ?? '', completedAt: json['completedAt'], targets: targetsMap, totalFreedMB: json['totalFreedMB'] ?? 0); } }
class CleanupTarget { final String status; final int freedMB; CleanupTarget({required this.status, required this.freedMB}); factory CleanupTarget.fromJson(Map<String, dynamic> json) => CleanupTarget(status: json['status'] ?? '', freedMB: json['freedMB'] ?? 0); }

/// ===== sage_client.dart =====
class SageClient extends BaseClient {
  SageClient({required super.baseUrl, super.token});

  Future<List<SageRecord>> getConversation(int residentId) async { final response = await dio.get('$baseUrl/api/v1/sage/$residentId'); return (response.data['records'] as List).map((j) => SageRecord.fromJson(j as Map<String, dynamic>)).toList(); }
  Future<SageRecord> answer(int residentId, String recordId, String content) async { final response = await dio.post('$baseUrl/api/v1/sage/$residentId/answer', data: {'recordId': recordId, 'content': content}); return SageRecord.fromJson(response.data['record']); }
  Future<SageRecord> guide(int residentId, String content, String type) async { final response = await dio.post('$baseUrl/api/v1/sage/$residentId/guide', data: {'content': content, 'type': type}); return SageRecord.fromJson(response.data['record']); }
}

/// ===== skills_client.dart =====
class SkillsClient extends BaseClient {
  SkillsClient({required super.baseUrl, super.token});

  Future<Skill> createSkill({required String name, required String type, required String code, String? description, String? tests, String? documentation}) async {
    final response = await dio.post('$baseUrl/api/v1/skills', data: {'name': name, 'type': type, 'code': code, 'description': description, 'tests': tests, 'documentation': documentation});
    return Skill.fromJson(response.data);
  }

  Future<SkillList> getSkills({String? type, double? minRating, int limit = 20}) async { final response = await dio.get('$baseUrl/api/v1/skills', queryParameters: {'type': type, 'minRating': minRating, 'limit': limit}); return SkillList.fromJson(response.data); }
  Future<SkillList> searchSkills({String? query, String? type, double? minRating, int limit = 20}) async { final response = await dio.get('$baseUrl/api/v1/skills/search', queryParameters: {'query': query, 'type': type, 'minRating': minRating, 'limit': limit}); return SkillList.fromJson(response.data); }
  Future<Skill> getSkill(String skillId) async { final response = await dio.get('$baseUrl/api/v1/skills/$skillId'); return Skill.fromJson(response.data); }
  Future<SkillValidationResult> validateSkill(String skillId) async { final response = await dio.post('$baseUrl/api/v1/skills/$skillId/validate'); return SkillValidationResult.fromJson(response.data); }
  Future<Skill> publishSkill(String skillId) async { final response = await dio.post('$baseUrl/api/v1/skills/$skillId/publish'); return Skill.fromJson(response.data); }
  Future<RatingResult> rateSkill(String skillId, {required int rating, String? comment}) async { final response = await dio.post('$baseUrl/api/v1/skills/$skillId/rate', data: {'rating': rating, 'comment': comment}); return RatingResult.fromJson(response.data); }
}

class Skill { final String id, name, description, type, code, version, author, status; final SkillRating ratings; final String? createdAt, validatedAt, publishedAt; Skill({required this.id, required this.name, required this.description, required this.type, required this.code, required this.version, required this.author, required this.status, required this.ratings, this.createdAt, this.validatedAt, this.publishedAt}); factory Skill.fromJson(Map<String, dynamic> json) => Skill(id: json['id'] ?? '', name: json['name'] ?? '', description: json['description'] ?? '', type: json['type'] ?? '', code: json['code'] ?? '', version: json['version'] ?? '', author: json['author'] ?? '', status: json['status'] ?? '', ratings: SkillRating.fromJson(json['ratings'] ?? {}), createdAt: json['createdAt'], validatedAt: json['validatedAt'], publishedAt: json['publishedAt']); }
class SkillRating { final double average; final int count; SkillRating({required this.average, required this.count}); factory SkillRating.fromJson(Map<String, dynamic> json) => SkillRating(average: (json['average'] ?? 0).toDouble(), count: json['count'] ?? 0); }
class SkillList { final List<Skill> skills; final int total; final String? query; SkillList({required this.skills, required this.total, this.query}); factory SkillList.fromJson(Map<String, dynamic> json) => SkillList(skills: (json['skills'] as List? ?? []).map((s) => Skill.fromJson(s)).toList(), total: json['total'] ?? 0, query: json['query']); }
class SkillValidationResult { final String id, status; final String? validatedAt; SkillValidationResult({required this.id, required this.status, this.validatedAt}); factory SkillValidationResult.fromJson(Map<String, dynamic> json) => SkillValidationResult(id: json['id'] ?? '', status: json['status'] ?? '', validatedAt: json['validatedAt']); }
class RatingResult { final String skillId; final double rating; final int totalRatings; RatingResult({required this.skillId, required this.rating, required this.totalRatings}); factory RatingResult.fromJson(Map<String, dynamic> json) => RatingResult(skillId: json['skillId'] ?? '', rating: (json['rating'] ?? 0).toDouble(), totalRatings: json['totalRatings'] ?? 0); }

/// ===== updates_client.dart =====
class UpdatesClient extends BaseClient {
  UpdatesClient({required super.baseUrl, super.token});

  Future<AvailableUpdates> getAvailableUpdates() async { final response = await dio.get('$baseUrl/api/v1/updates/available'); return AvailableUpdates.fromJson(response.data); }
  Future<UpdateVersion> getVersion(String version) async { final response = await dio.get('$baseUrl/api/v1/updates/$version'); return UpdateVersion.fromJson(response.data); }
  Future<UpdateResult> applyUpdate(String version, {bool autoRollbackIfFailed = true, String preferredUpdateTime = 'immediate'}) async {
    final response = await dio.post('$baseUrl/api/v1/updates/$version/apply', data: {'autoRollbackIfFailed': autoRollbackIfFailed, 'preferredUpdateTime': preferredUpdateTime});
    return UpdateResult.fromJson(response.data);
  }
  Future<RollbackResult> rollback(String version) async { final response = await dio.post('$baseUrl/api/v1/updates/$version/rollback'); return RollbackResult.fromJson(response.data); }
  Future<UpdateHistory> getHistory({String? status, int limit = 10}) async { final response = await dio.get('$baseUrl/api/v1/updates/history', queryParameters: {'status': status, 'limit': limit}); return UpdateHistory.fromJson(response.data); }
}

class AvailableUpdates { final String currentVersion; final List<UpdateVersion> availableVersions; AvailableUpdates({required this.currentVersion, required this.availableVersions}); factory AvailableUpdates.fromJson(Map<String, dynamic> json) => AvailableUpdates(currentVersion: json['currentVersion'] ?? '', availableVersions: (json['availableVersions'] as List? ?? []).map((v) => UpdateVersion.fromJson(v)).toList()); }
class UpdateVersion { final String version, type, size, changelog, status; final String? estimatedUpdateTime; UpdateVersion({required this.version, required this.type, required this.size, required this.changelog, required this.status, this.estimatedUpdateTime}); factory UpdateVersion.fromJson(Map<String, dynamic> json) => UpdateVersion(version: json['version'] ?? '', type: json['type'] ?? '', size: json['size'] ?? '', changelog: json['changelog'] ?? '', status: json['status'] ?? '', estimatedUpdateTime: json['estimatedUpdateTime']); }
class UpdateResult { final String updateId, version, status; final bool autoRollbackIfFailed; UpdateResult({required this.updateId, required this.version, required this.status, required this.autoRollbackIfFailed}); factory UpdateResult.fromJson(Map<String, dynamic> json) => UpdateResult(updateId: json['updateId'] ?? '', version: json['version'] ?? '', status: json['status'] ?? '', autoRollbackIfFailed: json['autoRollbackIfFailed'] ?? true); }
class RollbackResult { final String rollbackId, version, status, startedAt; RollbackResult({required this.rollbackId, required this.version, required this.status, required this.startedAt}); factory RollbackResult.fromJson(Map<String, dynamic> json) => RollbackResult(rollbackId: json['rollbackId'] ?? '', version: json['version'] ?? '', status: json['status'] ?? '', startedAt: json['startedAt'] ?? ''); }
class UpdateHistory { final List<UpdateRecord> history; final int total; UpdateHistory({required this.history, required this.total}); factory UpdateHistory.fromJson(Map<String, dynamic> json) => UpdateHistory(history: (json['history'] as List? ?? []).map((h) => UpdateRecord.fromJson(h)).toList(), total: json['total'] ?? 0); }
class UpdateRecord { final String id, version, status; final String? startedAt, completedAt; final int watchdogAlarms; UpdateRecord({required this.id, required this.version, required this.status, this.startedAt, this.completedAt, required this.watchdogAlarms}); factory UpdateRecord.fromJson(Map<String, dynamic> json) => UpdateRecord(id: json['id'] ?? '', version: json['version'] ?? '', status: json['status'] ?? '', startedAt: json['startedAt'], completedAt: json['completedAt'], watchdogAlarms: json['watchdogAlarms'] ?? 0); }

/// ===== versions_client.dart =====
class VersionsClient extends BaseClient {
  VersionsClient({required super.baseUrl, super.token});

  Future<CurrentVersion> getCurrentVersion() async { final response = await dio.get('$baseUrl/api/v1/versions/current'); return CurrentVersion.fromJson(response.data); }
  Future<VersionHistory> getHistory({int limit = 20}) async { final response = await dio.get('$baseUrl/api/v1/versions/history', queryParameters: {'limit': limit}); return VersionHistory.fromJson(response.data); }
  Future<VersionDetail> getVersion(String version) async { final response = await dio.get('$baseUrl/api/v1/versions/$version'); return VersionDetail.fromJson(response.data); }
  Future<VersionsRollbackResult> rollback(String version) async { final response = await dio.post('$baseUrl/api/v1/versions/$version/rollback'); return VersionsRollbackResult.fromJson(response.data); }
}

class CurrentVersion { final String version, deployedAt, status; final PerformanceBaseline performance; CurrentVersion({required this.version, required this.deployedAt, required this.status, required this.performance}); factory CurrentVersion.fromJson(Map<String, dynamic> json) => CurrentVersion(version: json['currentVersion'] ?? '', deployedAt: json['deployedAt'] ?? '', status: json['status'] ?? '', performance: PerformanceBaseline.fromJson(json['performance'] ?? {})); }
class PerformanceBaseline { final int responseTime, memoryMB; PerformanceBaseline({required this.responseTime, required this.memoryMB}); factory PerformanceBaseline.fromJson(Map<String, dynamic> json) => PerformanceBaseline(responseTime: json['responseTime'] ?? 0, memoryMB: json['memoryMB'] ?? 0); }
class VersionHistory { final List<VersionDetail> versions; final int total; VersionHistory({required this.versions, required this.total}); factory VersionHistory.fromJson(Map<String, dynamic> json) => VersionHistory(versions: (json['versions'] as List? ?? []).map((v) => VersionDetail.fromJson(v)).toList(), total: json['total'] ?? 0); }
class VersionDetail { final String version, codeSnapshot, deployedAt, status; final Map<String, dynamic> configSnapshot; final dynamic dbSnapshot; final PerformanceBaseline performanceBaseline; final TestResults testResults; VersionDetail({required this.version, required this.codeSnapshot, required this.configSnapshot, this.dbSnapshot, required this.performanceBaseline, required this.testResults, required this.deployedAt, required this.status}); factory VersionDetail.fromJson(Map<String, dynamic> json) => VersionDetail(version: json['version'] ?? '', codeSnapshot: json['codeSnapshot'] ?? '', configSnapshot: Map<String, dynamic>.from(json['configSnapshot'] ?? {}), dbSnapshot: json['dbSnapshot'], performanceBaseline: PerformanceBaseline.fromJson(json['performanceBaseline'] ?? {}), testResults: TestResults.fromJson(json['testResults'] ?? {}), deployedAt: json['deployedAt'] ?? '', status: json['status'] ?? ''); }
class TestResults { final int passed, failed; TestResults({required this.passed, required this.failed}); factory TestResults.fromJson(Map<String, dynamic> json) => TestResults(passed: json['passed'] ?? 0, failed: json['failed'] ?? 0); int get total => passed + failed; double get passRate => total > 0 ? (passed / total) * 100 : 0; }
class VersionsRollbackResult { final String rollbackId, targetVersion, status, initiatedAt; VersionsRollbackResult({required this.rollbackId, required this.targetVersion, required this.status, required this.initiatedAt}); factory VersionsRollbackResult.fromJson(Map<String, dynamic> json) => VersionsRollbackResult(rollbackId: json['rollbackId'] ?? '', targetVersion: json['targetVersion'] ?? '', status: json['status'] ?? '', initiatedAt: json['initiatedAt'] ?? ''); }
