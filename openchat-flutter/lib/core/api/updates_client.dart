import 'package:openchat_flutter/core/api/base_client.dart';

class UpdatesClient extends BaseClient {
  UpdatesClient({required super.baseUrl, super.token});

  Future<AvailableUpdates> getAvailableUpdates() async {
    final response = await dio.get('$baseUrl/api/v1/updates/available');
    return AvailableUpdates.fromJson(response.data);
  }

  Future<UpdateVersion> getVersion(String version) async {
    final response = await dio.get('$baseUrl/api/v1/updates/$version');
    return UpdateVersion.fromJson(response.data);
  }

  Future<UpdateResult> applyUpdate(String version, {bool autoRollbackIfFailed = true, String preferredUpdateTime = 'immediate'}) async {
    final response = await dio.post('$baseUrl/api/v1/updates/$version/apply', data: {'autoRollbackIfFailed': autoRollbackIfFailed, 'preferredUpdateTime': preferredUpdateTime});
    return UpdateResult.fromJson(response.data);
  }

  Future<RollbackResult> rollback(String version) async {
    final response = await dio.post('$baseUrl/api/v1/updates/$version/rollback');
    return RollbackResult.fromJson(response.data);
  }

  Future<UpdateHistory> getHistory({String? status, int limit = 10}) async {
    final response = await dio.get('$baseUrl/api/v1/updates/history', queryParameters: {'status': status, 'limit': limit});
    return UpdateHistory.fromJson(response.data);
  }
}

class AvailableUpdates {
  final String currentVersion;
  final List<UpdateVersion> availableVersions;

  AvailableUpdates({required this.currentVersion, required this.availableVersions});

  factory AvailableUpdates.fromJson(Map<String, dynamic> json) {
    return AvailableUpdates(currentVersion: json['currentVersion'] ?? '', availableVersions: (json['availableVersions'] as List? ?? []).map((v) => UpdateVersion.fromJson(v)).toList());
  }
}

class UpdateVersion {
  final String version, type, size, changelog, status;
  final String? estimatedUpdateTime;

  UpdateVersion({required this.version, required this.type, required this.size, required this.changelog, required this.status, this.estimatedUpdateTime});

  factory UpdateVersion.fromJson(Map<String, dynamic> json) {
    return UpdateVersion(version: json['version'] ?? '', type: json['type'] ?? '', size: json['size'] ?? '', changelog: json['changelog'] ?? '', status: json['status'] ?? '', estimatedUpdateTime: json['estimatedUpdateTime']);
  }
}

class UpdateResult {
  final String updateId, version, status;
  final bool autoRollbackIfFailed;

  UpdateResult({required this.updateId, required this.version, required this.status, required this.autoRollbackIfFailed});

  factory UpdateResult.fromJson(Map<String, dynamic> json) {
    return UpdateResult(updateId: json['updateId'] ?? '', version: json['version'] ?? '', status: json['status'] ?? '', autoRollbackIfFailed: json['autoRollbackIfFailed'] ?? true);
  }
}

class RollbackResult {
  final String rollbackId, version, status, startedAt;

  RollbackResult({required this.rollbackId, required this.version, required this.status, required this.startedAt});

  factory RollbackResult.fromJson(Map<String, dynamic> json) {
    return RollbackResult(rollbackId: json['rollbackId'] ?? '', version: json['version'] ?? '', status: json['status'] ?? '', startedAt: json['startedAt'] ?? '');
  }
}

class UpdateHistory {
  final List<UpdateRecord> history;
  final int total;

  UpdateHistory({required this.history, required this.total});

  factory UpdateHistory.fromJson(Map<String, dynamic> json) {
    return UpdateHistory(history: (json['history'] as List? ?? []).map((h) => UpdateRecord.fromJson(h)).toList(), total: json['total'] ?? 0);
  }
}

class UpdateRecord {
  final String id, version, status;
  final String? startedAt, completedAt;
  final int watchdogAlarms;

  UpdateRecord({required this.id, required this.version, required this.status, this.startedAt, this.completedAt, required this.watchdogAlarms});

  factory UpdateRecord.fromJson(Map<String, dynamic> json) {
    return UpdateRecord(id: json['id'] ?? '', version: json['version'] ?? '', status: json['status'] ?? '', startedAt: json['startedAt'], completedAt: json['completedAt'], watchdogAlarms: json['watchdogAlarms'] ?? 0);
  }
}
