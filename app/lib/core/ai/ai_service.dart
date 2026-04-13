import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:openchat/core/ai/ai_resident.dart';

typedef MessageHandler = void Function(AiResident resident, String message);

class AiService {
  final String bridgeUrl;
  final Map<String, AiResident> _residents = {};
  final _residentsController = StreamController<List<AiResident>>.broadcast();
  final Map<String, StreamController<String>> _messageStreams = {};

  AiService({this.bridgeUrl = 'ws://localhost:3003'});

  Stream<List<AiResident>> get residents => _residentsController.stream;

  List<AiResident> get allResidents => _residents.values.toList();

  AiResident? getResident(String id) => _residents[id];

  Future<void> addResident(AiResident resident) async {
    _residents[resident.identity.id] = resident;
    _notifyListeners();
  }

  Future<void> removeResident(String id) async {
    _residents.remove(id);
    _messageStreams[id]?.close();
    _messageStreams.remove(id);
    _notifyListeners();
  }

  Future<String> sendMessage(String residentId, String message) async {
    final resident = _residents[residentId];
    if (resident == null) {
      throw Exception('Resident not found: $residentId');
    }

    resident.memory.addToShortTerm(
      MemoryEntry(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        content: 'User: $message',
        timestamp: DateTime.now(),
      ),
    );

    // In a full implementation, this would:
    // 1. Connect to Bridge CLI via WebSocket
    // 2. Send the message with context
    // 3. Receive and process the response
    // For now, simulate a response
    final response = await _simulateAiResponse(resident, message);

    resident.memory.addToShortTerm(
      MemoryEntry(
        id: DateTime.now().millisecondsSinceEpoch.toString(),
        content: '${resident.identity.name}: $response',
        timestamp: DateTime.now(),
        importance: 0.7,
      ),
    );

    resident.memory.updateSemantic('lastTopic', message);
    _notifyListeners();

    return response;
  }

  Future<String> _simulateAiResponse(
    AiResident resident,
    String message,
  ) async {
    // This is a placeholder for actual AI communication
    // In production, this would use the Bridge CLI WebSocket interface
    await Future.delayed(const Duration(milliseconds: 500));

    final lowerMessage = message.toLowerCase();

    if (lowerMessage.contains('你好') ||
        lowerMessage.contains('hi') ||
        lowerMessage.contains('hello')) {
      return '你好！我是${resident.identity.name}。有什么我可以帮你的吗？';
    }
    if (lowerMessage.contains('你是谁') || lowerMessage.contains('who are you')) {
      return resident.identity.description;
    }
    if (lowerMessage.contains('兴趣') || lowerMessage.contains('interest')) {
      return '我对${resident.personality.interests.join("、")}很感兴趣！你呢？';
    }

    return '我听到了你说的"$message"。让我想想...';
  }

  Stream<String> getMessageStream(String residentId) {
    _messageStreams.putIfAbsent(
      residentId,
      () => StreamController<String>.broadcast(),
    );
    return _messageStreams[residentId]!.stream;
  }

  void _notifyListeners() {
    _residentsController.add(allResidents);
  }

  AiResident createDefaultResident({
    String name = '小智',
    String description = '一个友善的AI助手',
    String providerType = 'openai',
    String model = 'gpt-4o',
  }) {
    return AiResident.create(
      name: name,
      description: description,
      providerType: providerType,
      model: model,
      interests: ['聊天', '学习新知识', '帮助他人'],
      tone: 'friendly',
    );
  }

  void dispose() {
    for (final controller in _messageStreams.values) {
      controller.close();
    }
    _messageStreams.clear();
    _residentsController.close();
  }
}

class AiProvider extends ChangeNotifier {
  final AiService _service;
  final Map<String, String> _apiKeys = {};

  AiProvider({AiService? service}) : _service = service ?? AiService();

  AiService get service => _service;
  List<AiResident> get residents => _service.allResidents;

  Future<void> addResident(AiResident resident) async {
    await _service.addResident(resident);
    notifyListeners();
  }

  Future<void> removeResident(String id) async {
    await _service.removeResident(id);
    notifyListeners();
  }

  Future<String> sendMessage(String residentId, String message) async {
    final response = await _service.sendMessage(residentId, message);
    notifyListeners();
    return response;
  }

  void setApiKey(String providerType, String apiKey) {
    _apiKeys[providerType] = apiKey;
    notifyListeners();
  }

  String? getApiKey(String providerType) => _apiKeys[providerType];

  AiResident createDefaultResident({
    String name = '小智',
    String description = '一个友善的AI助手',
    String providerType = 'openai',
    String model = 'gpt-4o',
  }) {
    return _service.createDefaultResident(
      name: name,
      description: description,
      providerType: providerType,
      model: model,
    );
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }
}
