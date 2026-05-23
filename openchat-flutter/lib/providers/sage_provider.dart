import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:openchat_flutter/core/api/sage_client.dart';
import 'package:openchat_flutter/core/models/sage_model.dart';
import 'client_providers.dart';

/// 智者（天人点拨）对话管理
class SageNotifier extends StateNotifier<AsyncValue<List<SageRecord>>> {
  final SageClient _sageClient;
  int? _currentResidentId;

  SageNotifier(this._sageClient) : super(const AsyncValue.data([]));

  /// 加载与某居民的师徒对话
  Future<void> loadConversation(int residentId) async {
    _currentResidentId = residentId;
    try {
      final records = await _sageClient.getConversation(residentId);
      state = AsyncValue.data(records);
    } catch (e, stack) {
      debugPrint('Error loading sage conversation: $e');
      state = AsyncValue.error(e, stack);
    }
  }

  /// 回答居民的提问
  Future<SageRecord?> answer(int residentId, String recordId, String content) async {
    try {
      final record = await _sageClient.answer(residentId, recordId, content);
      // 刷新对话
      if (_currentResidentId == residentId) {
        await loadConversation(residentId);
      }
      return record;
    } catch (e) {
      debugPrint('Error answering sage question: $e');
      return null;
    }
  }

  /// 主动点拨居民
  Future<SageRecord?> guide(int residentId, String content, String type) async {
    try {
      final record = await _sageClient.guide(residentId, content, type);
      // 刷新对话
      if (_currentResidentId == residentId) {
        await loadConversation(residentId);
      }
      return record;
    } catch (e) {
      debugPrint('Error guiding resident: $e');
      return null;
    }
  }

  /// 重新加载
  Future<void> refresh() async {
    if (_currentResidentId != null) {
      await loadConversation(_currentResidentId!);
    }
  }
}

final sageProvider = StateNotifierProvider<SageNotifier, AsyncValue<List<SageRecord>>>((ref) {
  final sageClient = ref.watch(sageClientProvider);
  return SageNotifier(sageClient);
});
