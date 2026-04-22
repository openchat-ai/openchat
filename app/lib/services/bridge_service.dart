import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:http/http.dart' as http;

/// Bridge 服务 - 连接后端 Bridge CLI
class BridgeService extends ChangeNotifier {
  final String host;
  final int port;

  WebSocketChannel? _channel;
  bool _isConnected = false;
  String? _sessionId;
  String? _currentProvider;
  String? _currentModel;

  // [优化] 复用 HTTP 客户端
  late final http.Client _httpClient;

  final _messageController = StreamController<BridgeMessage>.broadcast();
  final _statusController = StreamController<BridgeStatus>.broadcast();
  final _streamController = StreamController<StreamEvent>.broadcast();

  BridgeService({
    this.host = 'localhost',
    this.port = 3000,
  }) {
    _httpClient = http.Client();
  }

  // Getters
  bool get isConnected => _isConnected;
  String? get sessionId => _sessionId;
  String? get currentProvider => _currentProvider;
  String? get currentModel => _currentModel;
  String get baseUrl => 'http://$host:$port';
  String get wsUrl => 'ws://$host:$port/ws';

  // Streams
  Stream<BridgeMessage> get messages => _messageController.stream;
  Stream<BridgeStatus> get status => _statusController.stream;
  Stream<StreamEvent> get streamEvents => _streamController.stream;

  /// 连接到 Bridge
  Future<bool> connect() async {
    try {
      // 先检查 HTTP 状态
      final status = await fetchStatus();
      if (status == null) {
        debugPrint('[Bridge] Bridge 服务未运行');
        return false;
      }

      _currentProvider = status['currentProvider'];
      _currentModel = status['currentModel'];

      // 连接 WebSocket
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));

      _channel!.stream.listen(
        _handleMessage,
        onError: (error) {
          debugPrint('[Bridge] WebSocket 错误: $error');
          _isConnected = false;
          notifyListeners();
        },
        onDone: () {
          debugPrint('[Bridge] WebSocket 关闭');
          _isConnected = false;
          notifyListeners();
        },
      );

      _isConnected = true;
      notifyListeners();
      debugPrint('[Bridge] 已连接: $wsUrl');
      return true;
    } catch (e) {
      debugPrint('[Bridge] 连接失败: $e');
      return false;
    }
  }

  /// 断开连接
  void disconnect() {
    _channel?.sink.close();
    _channel = null;
    _isConnected = false;
    _sessionId = null;
    notifyListeners();
  }

  /// 获取 Bridge 状态
  Future<Map<String, dynamic>?> fetchStatus() async {
    try {
      final response = await _httpClient
          .get(Uri.parse('$baseUrl/api/status'))
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      }
      return null;
    } catch (e) {
      debugPrint('[Bridge] 获取状态失败: $e');
      return null;
    }
  }

  /// 获取 Provider 列表
  Future<List<Map<String, dynamic>>> fetchProviders() async {
    try {
      final response = await _httpClient
          .get(Uri.parse('$baseUrl/api/providers'))
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final providers = data['providers'] as List;
        return providers.cast<Map<String, dynamic>>();
      }
      return [];
    } catch (e) {
      debugPrint('[Bridge] 获取 Provider 列表失败: $e');
      return [];
    }
  }

  /// 配置 Provider
  Future<bool> configureProvider({
    required String providerId,
    String? apiKey,
    String? baseUrl,
  }) async {
    try {
      final response = await _httpClient
          .post(
            Uri.parse('$baseUrl/api/provider/connect'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'providerId': providerId,
              if (apiKey != null) 'apiKey': apiKey,
              if (baseUrl != null) 'baseUrl': baseUrl,
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        return data['success'] == true;
      }
      return false;
    } catch (e) {
      debugPrint('[Bridge] 配置 Provider 失败: $e');
      return false;
    }
  }

  /// 设置当前 Provider/Model
  Future<bool> setCurrentProvider({
    required String providerId,
    String? model,
  }) async {
    try {
      final response = await _httpClient
          .post(
            Uri.parse('$baseUrl/api/provider/set'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'providerId': providerId,
              if (model != null) 'model': model,
            }),
          )
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        _currentProvider = providerId;
        _currentModel = model;
        notifyListeners();
        return true;
      }
      return false;
    } catch (e) {
      debugPrint('[Bridge] 设置 Provider 失败: $e');
      return false;
    }
  }

  /// 发送聊天消息 (HTTP)
  Future<String?> sendMessageHttp(String message) async {
    try {
      final response = await _httpClient
          .post(
            Uri.parse('$baseUrl/api/chat'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'message': message,
              'sessionId': _sessionId,
            }),
          )
          .timeout(const Duration(minutes: 2));

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        _sessionId = data['sessionId'] as String?;
        return data['response'] as String?;
      }
      return null;
    } catch (e) {
      debugPrint('[Bridge] 发送消息失败: $e');
      return null;
    }
  }

  /// 发送聊天消息 (WebSocket)
  void sendMessage(String message) {
    if (!_isConnected || _channel == null) {
      debugPrint('[Bridge] 未连接，无法发送消息');
      return;
    }

    final msg = {
      'type': 'chat_message',
      'data': {'message': message},
      if (_sessionId != null) 'sessionId': _sessionId,
    };

    _channel!.sink.add(jsonEncode(msg));
  }

  /// 处理 WebSocket 消息
  void _handleMessage(dynamic data) {
    try {
      final msg = jsonDecode(data as String) as Map<String, dynamic>;
      final type = msg['type'] as String?;
      final msgData = msg['data'] as Map<String, dynamic>?;

      switch (type) {
        case 'bridge_handshake':
          debugPrint('[Bridge] 握手成功');
          break;

        case 'chat_response':
          _sessionId = msg['sessionId'] as String?;
          final content = msgData?['content'] as String?;
          if (content != null) {
            _messageController.add(BridgeMessage(
              type: BridgeMessageType.response,
              content: content,
              sessionId: _sessionId,
            ));
          }
          break;

        case 'bridge_status':
          final status = BridgeStatus(
            isConnected: true,
            currentProvider: msgData?['currentProvider'] as String?,
            currentModel: msgData?['currentModel'] as String?,
            uptime: msgData?['uptime'] as int?,
          );
          _statusController.add(status);
          break;

        case 'error':
          _messageController.add(BridgeMessage(
            type: BridgeMessageType.error,
            content: msgData?['message'] as String? ?? 'Unknown error',
          ));
          break;
      }
    } catch (e) {
      debugPrint('[Bridge] 解析消息失败: $e');
    }
  }

  @override
  void dispose() {
    disconnect();
    _httpClient.close();
    _messageController.close();
    _statusController.close();
    _streamController.close();
    super.dispose();
  }

  /// 发送聊天消息 (流式 SSE)
  /// 返回 `Stream<StreamEvent>` 用于实时显示打字机效果
  Stream<StreamEvent> sendMessageStream(String message) async* {
    final request = http.Request('POST', Uri.parse('$baseUrl/api/chat/stream'));
    request.headers['Content-Type'] = 'application/json';
    request.body = jsonEncode({
      'message': message,
      'sessionId': _sessionId,
    });

    try {
      final response = await _httpClient.send(request);

      if (response.statusCode != 200) {
        yield StreamEvent(type: StreamEventType.error, error: 'HTTP ${response.statusCode}');
        return;
      }

      // 手动处理 SSE 流
      final buffer = <int>[];
      await for (final chunk in response.stream) {
        buffer.addAll(chunk);

        // 尝试解析完整的行
        final text = utf8.decode(buffer);
        final lines = text.split('\n');

        // 保留最后一行（可能不完整）
        for (int i = 0; i < lines.length - 1; i++) {
          final line = lines[i].trim();
          if (line.isEmpty) continue;

          if (line.startsWith('event: ')) {
            // 跳过事件类型行
            continue;
          }

          if (line.startsWith('data: ')) {
            final dataStr = line.substring(6);
            try {
              final data = jsonDecode(dataStr) as Map<String, dynamic>;

              if (data.containsKey('sessionId')) {
                _sessionId = data['sessionId'] as String?;
                yield StreamEvent(type: StreamEventType.session, sessionId: _sessionId);
              } else if (data.containsKey('chunk')) {
                yield StreamEvent(type: StreamEventType.content, content: data['chunk'] as String);
              } else if (data.containsKey('response')) {
                yield StreamEvent(type: StreamEventType.complete, content: data['response'] as String);
              } else if (data.containsKey('tool')) {
                yield StreamEvent(
                  type: StreamEventType.toolCall,
                  toolName: data['tool'] as String,
                  toolArgs: data['args'],
                );
              } else if (data.containsKey('message')) {
                yield StreamEvent(type: StreamEventType.error, error: data['message'] as String);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }

        // 清空已处理的缓冲区
        buffer.clear();
        if (lines.isNotEmpty) {
          buffer.addAll(utf8.encode(lines.last));
        }
      }
    } catch (e) {
      yield StreamEvent(type: StreamEventType.error, error: e.toString());
    }
  }
}

/// 流式事件
class StreamEvent {
  final StreamEventType type;
  final String? content;
  final String? sessionId;
  final String? error;
  final String? toolName;
  final dynamic toolArgs;
  final int? iteration;

  StreamEvent({
    required this.type,
    this.content,
    this.sessionId,
    this.error,
    this.toolName,
    this.toolArgs,
    this.iteration,
  });
}

enum StreamEventType {
  session,     // 会话创建
  thinking,    // AI 思考中
  content,     // 内容块
  toolCall,    // 工具调用
  toolResult,  // 工具结果
  complete,    // 完成
  error,       // 错误
}

/// Bridge 消息
class BridgeMessage {
  final BridgeMessageType type;
  final String content;
  final String? sessionId;

  BridgeMessage({
    required this.type,
    required this.content,
    this.sessionId,
  });
}

enum BridgeMessageType {
  response,
  error,
  thinking,
  toolCall,
}

/// Bridge 状态
class BridgeStatus {
  final bool isConnected;
  final String? currentProvider;
  final String? currentModel;
  final int? uptime;

  BridgeStatus({
    required this.isConnected,
    this.currentProvider,
    this.currentModel,
    this.uptime,
  });
}

/// AI 相关 API
extension BridgeAiApi on BridgeService {
  /// 获取或创建主 AI
  Future<Map<String, dynamic>?> fetchOrCreateMainAi({
    required String name,
    required String providerId,
    String? model,
    Map<String, dynamic>? config,
  }) async {
    try {
      final response = await _httpClient
          .post(
            Uri.parse('$baseUrl/api/ai/main'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'name': name,
              'providerId': providerId,
              'model': model,
              'config': config,
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      }
      return null;
    } catch (e) {
      debugPrint('[Bridge] 获取/创建主 AI 失败: $e');
      return null;
    }
  }

  /// 创建子 AI
  Future<Map<String, dynamic>?> createChildAi({
    required String name,
    required String parentId,
  }) async {
    try {
      final response = await _httpClient
          .post(
            Uri.parse('$baseUrl/api/ai/child'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({
              'name': name,
              'parentId': parentId,
            }),
          )
          .timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      }
      return null;
    } catch (e) {
      debugPrint('[Bridge] 创建子 AI 失败: $e');
      return null;
    }
  }

  /// 获取当前主 AI 信息
  Future<Map<String, dynamic>?> getMainAi() async {
    try {
      final response = await _httpClient
          .get(Uri.parse('$baseUrl/api/ai/main'))
          .timeout(const Duration(seconds: 5));

      if (response.statusCode == 200) {
        return jsonDecode(response.body) as Map<String, dynamic>;
      }
      return null;
    } catch (e) {
      debugPrint('[Bridge] 获取主 AI 失败: $e');
      return null;
    }
  }
}
