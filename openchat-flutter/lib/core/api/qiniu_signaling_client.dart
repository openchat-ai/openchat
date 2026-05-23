/// 七牛云信令客户端 - Flutter 版
///
/// 用途：手机通过七牛云存储与 Bridge 交换 P2P 连接信息 + 数据中继
library;

import 'dart:async';
import 'package:dio/dio.dart';

class QiniuSignalingClient {
  final String bridgeUrl;
  final String peerId;

  String? currentRoomId;
  Timer? _pollTimer;
  Timer? _dataPollTimer;
  String _lastDataTimestamp = '';

  // 回调
  Function(Map<String, dynamic>)? onDataReceived;

  QiniuSignalingClient({
    this.bridgeUrl = 'http://localhost:3800',
    String? peerId,
  }) : peerId = peerId ?? 'phone_${DateTime.now().millisecondsSinceEpoch}';

  /// 申请房间 (让 Bridge 知道有手机要连接)
  Future<Map<String, dynamic>> applyForRoom() async {
    final dio = Dio(BaseOptions(baseUrl: bridgeUrl));

    try {
      final response = await dio.post(
        '/api/v1/signaling/request-room',
        data: {'peerId': peerId}
      );

      if (response.data['success'] == true) {
        currentRoomId = response.data['roomId'];
        return response.data;
      } else {
        throw Exception(response.data['error'] ?? 'Failed to apply for room');
      }
    } catch (e) {
      throw Exception('Failed to apply for room: $e');
    }
  }

  /// 写入 Offer (SDP)
  Future<void> writeOffer(Map<String, dynamic> sdp) async {
    if (currentRoomId == null) throw Exception('Not in a room');

    final dio = Dio(BaseOptions(baseUrl: bridgeUrl));
    await dio.post(
      '/api/v1/signaling/room/$currentRoomId/offer',
      data: {'sdp': sdp}
    );
  }

  /// 读取 Answer (SDP)
  Future<Map<String, dynamic>?> readAnswer() async {
    if (currentRoomId == null) throw Exception('Not in a room');

    final dio = Dio(BaseOptions(baseUrl: bridgeUrl));
    try {
      final response = await dio.get(
        '/api/v1/signaling/room/$currentRoomId',
        queryParameters: {'lastTimestamp': ''}
      );

      if (response.data['offer'] != null) {
        return response.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /// 开始轮询 Answer
  void startPollingAnswer({int intervalSeconds = 2}) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(Duration(seconds: intervalSeconds), (_) async {
      try {
        final answer = await readAnswer();
        if (answer != null) {
          onDataReceived?.call(answer);
        }
      } catch (e) {
        // 忽略轮询错误
      }
    });
  }

  /// 停止轮询
  void stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  // ========== 数据转发功能 ==========

  /// 发送数据到 Bridge (通过七牛云)
  Future<void> sendDataToBridge(dynamic data) async {
    if (currentRoomId == null) throw Exception('Not in a room');

    final dio = Dio(BaseOptions(baseUrl: bridgeUrl));
    await dio.post(
      '/api/v1/signaling/room/$currentRoomId/data',
      data: {'data': data}
    );
  }

  /// 检查 Bridge 发来的数据 (中继模式)
  Future<Map<String, dynamic>?> checkRelayData() async {
    if (currentRoomId == null) return null;

    final dio = Dio(BaseOptions(baseUrl: bridgeUrl));
    try {
      final response = await dio.get(
        '/api/v1/signaling/room/$currentRoomId/relay',
        queryParameters: {'lastTimestamp': _lastDataTimestamp}
      );

      if (response.data['success'] == true) {
        _lastDataTimestamp = response.data['timestamp'] ?? '';
        return response.data;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  /// 开始轮询中继数据
  void startRelayPolling({int intervalMs = 1000}) {
    _dataPollTimer?.cancel();
    _dataPollTimer = Timer.periodic(Duration(milliseconds: intervalMs), (_) async {
      try {
        final result = await checkRelayData();
        if (result != null && result['data'] != null) {
          onDataReceived?.call(result['data']);
        }
      } catch (e) {
        // 忽略轮询错误
      }
    });
  }

  /// 停止轮询
  void stopRelayPolling() {
    _dataPollTimer?.cancel();
    _dataPollTimer = null;
  }

  /// 释放房间
  Future<void> releaseRoom() async {
    if (currentRoomId == null) return;

    final dio = Dio(BaseOptions(baseUrl: bridgeUrl));
    await dio.delete('/api/v1/signaling/room/$currentRoomId');
  }

  /// 获取上传 Token
  Future<String> getUploadToken() async {
    final dio = Dio(BaseOptions(baseUrl: bridgeUrl));
    final response = await dio.get('/api/v1/signaling/token');
    return response.data['token'] ?? '';
  }
  void dispose() {
    stopPolling();
    stopRelayPolling();
  }
}