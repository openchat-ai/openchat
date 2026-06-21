import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/core/api/base_client.dart';
import 'package:openchat_flutter/core/models/agent_model.dart';
import 'client_providers.dart';

/// Agent state management
class AgentNotifier extends StateNotifier<AsyncValue<List<Agent>>> {
  final AgentClient _client;
  Timer? _pollTimer;

  AgentNotifier(this._client) : super(const AsyncValue.loading()) {
    refreshAgents();
  }

  /// Refresh agent list
  Future<void> refreshAgents() async {
    state = const AsyncValue.loading();
    try {
      final agents = await _client.getAgents();
      state = AsyncValue.data(agents);
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }

  /// Create a new agent and start tracking
  Future<void> spawnAgent({
    required String role,
    String? name,
    String? task,
  }) async {
    try {
      final newAgent = await _client.createAgent(role: role, name: name, task: task);
      
      // 更新当前列表
      final currentAgents = state.value ?? [];
      state = AsyncValue.data([...currentAgents, newAgent]);
      
      // 启动自动轮询监控
      _startPolling(newAgent.id);
    } catch (e) {
      state = AsyncValue.error(e, StackTrace.current);
    }
  }

  /// 终止 Agent
  Future<void> stopAgent(String id) async {
    try {
      await _client.terminateAgent(id);
      final currentAgents = state.value ?? [];
      state = AsyncValue.data(currentAgents.where((a) => a.id != id).toList());
    } catch (e) {
      debugPrint('Error terminating agent: $e');
    }
  }

  /// Status tracking polling
  void _startPolling(String agentId) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (timer) async {
      try {
        final updatedAgent = await _client.getAgentDetails(agentId);
        
        if (updatedAgent.status == AgentStatus.completed || 
            updatedAgent.status == AgentStatus.failed || 
            updatedAgent.status == AgentStatus.terminated) {
          timer.cancel();
        }

        // Update corresponding agent in list
        final currentAgents = state.value ?? [];
        final updatedList = currentAgents.map((a) => a.id == agentId ? updatedAgent : a).toList();
        state = AsyncValue.data(updatedList);
      } catch (e) {
        debugPrint('Polling error for agent $agentId: $e');
      }
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}

final agentProvider = StateNotifierProvider<AgentNotifier, AsyncValue<List<Agent>>>((ref) {
  return AgentNotifier(ref.watch(agentClientProvider));
});
