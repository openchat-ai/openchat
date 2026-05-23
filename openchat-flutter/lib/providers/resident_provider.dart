import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/core/api/resident_client.dart';
import 'package:openchat_flutter/core/api/agent_client.dart';
import 'package:openchat_flutter/core/models/resident_model.dart';
import 'package:openchat_flutter/core/models/agent_model.dart';
import 'client_providers.dart';

/// AI 居民状态管理
class ResidentNotifier extends StateNotifier<AsyncValue<List<Resident>>> {
  final ResidentClient _residentClient;
  final AgentClient _agentClient;

  ResidentNotifier(this._residentClient, this._agentClient)
      : super(const AsyncValue.loading()) {
    refresh();
  }

  /// 刷新全体居民名单
  Future<void> refresh({String? status}) async {
    state = const AsyncValue.loading();
    try {
      final residents = await _residentClient.getResidents(status: status);
      state = AsyncValue.data(residents);
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }

  /// 出生 — 创建新居民（可选 parentId 指定父居民）
  Future<Resident?> create({String? name, int? parentId}) async {
    try {
      final resident = await _residentClient.createResident(
        name: name,
        parentId: parentId,
      );
      final currentList = state.value ?? [];
      state = AsyncValue.data([resident, ...currentList]);
      return resident;
    } catch (e) {
      debugPrint('Error creating resident: $e');
      return null;
    }
  }

  /// 注销
  Future<void> delete(int id) async {
    try {
      await _residentClient.deleteResident(id);
      final currentList = state.value ?? [];
      state = AsyncValue.data(currentList.where((r) => r.id != id).toList());
    } catch (e) {
      debugPrint('Error deleting resident: $e');
    }
  }

  /// 获取居民档案（含活动履历）
  Future<Resident> getDetail(int id) async {
    return await _residentClient.getResidentDetail(id);
  }

  /// 查子孙列表
  Future<List<ChildSummary>> getChildren(int id) async {
    return await _residentClient.getChildren(id);
  }

  /// 获取居民名下的 Agent 列表
  Future<List<Agent>> getAgents(int residentId, {String? status}) async {
    return await _agentClient.getAgents(
      residentId: residentId,
      status: status,
    );
  }

  /// 为居民创建 Agent
  Future<Agent?> createAgent({
    required int residentId,
    required String role,
    String? name,
    String? task,
  }) async {
    try {
      return await _agentClient.createAgent(
        role: role,
        name: name,
        task: task,
        residentId: residentId,
      );
    } catch (e) {
      debugPrint('Error creating agent for resident: $e');
      return null;
    }
  }

  /// 终止 Agent
  Future<void> terminateAgent(String agentId) async {
    try {
      await _agentClient.terminateAgent(agentId);
    } catch (e) {
      debugPrint('Error terminating agent: $e');
    }
  }
}

final residentProvider =
    StateNotifierProvider<ResidentNotifier, AsyncValue<List<Resident>>>((ref) {
  final residentClient = ref.watch(residentClientProvider);
  final agentClient = ref.watch(agentClientProvider);
  return ResidentNotifier(residentClient, agentClient);
});
