import 'package:openchat_flutter/core/api/base_client.dart';

class ResourcesClient extends BaseClient {
  ResourcesClient({required super.baseUrl, super.token});

  Future<ResourceStatus> getStatus() async {
    final response = await dio.get('$baseUrl/api/v1/resources/status');
    return ResourceStatus.fromJson(response.data);
  }

  Future<PolicyResult> updatePolicy({String? compression, bool? cacheEnabled, String? networkMode, int? maxStorageMB}) async {
    final response = await dio.put('$baseUrl/api/v1/resources/policy', data: {
      if (compression != null) 'compression': compression,
      if (cacheEnabled != null) 'cacheEnabled': cacheEnabled,
      if (networkMode != null) 'networkMode': networkMode,
      if (maxStorageMB != null) 'maxStorageMB': maxStorageMB,
    });
    return PolicyResult.fromJson(response.data);
  }

  Future<CleanupResult> cleanup({List<String>? targets}) async {
    final response = await dio.post('$baseUrl/api/v1/resources/cleanup', data: {'targets': targets ?? ['cache', 'logs', 'temp']});
    return CleanupResult.fromJson(response.data);
  }
}

class ResourceStatus {
  final NetworkStatus network;
  final StorageStatus storage;
  final SystemStatus system;

  ResourceStatus({required this.network, required this.storage, required this.system});

  factory ResourceStatus.fromJson(Map<String, dynamic> json) {
    return ResourceStatus(
      network: NetworkStatus.fromJson(json['network'] ?? {}),
      storage: StorageStatus.fromJson(json['storage'] ?? {}),
      system: SystemStatus.fromJson(json['system'] ?? {}),
    );
  }
}

class NetworkStatus {
  final String mode, compression;
  final bool cacheEnabled;
  final int bytesSent, bytesReceived;

  NetworkStatus({required this.mode, required this.compression, required this.cacheEnabled, required this.bytesSent, required this.bytesReceived});

  factory NetworkStatus.fromJson(Map<String, dynamic> json) {
    return NetworkStatus(
      mode: json['mode'] ?? 'WiFi',
      compression: json['compression'] ?? 'gzip',
      cacheEnabled: json['cacheEnabled'] ?? true,
      bytesSent: json['bytesSent'] ?? 0,
      bytesReceived: json['bytesReceived'] ?? 0,
    );
  }
}

class StorageStatus {
  final int usedMB, totalMB, cacheMB, logsMB;

  StorageStatus({required this.usedMB, required this.totalMB, required this.cacheMB, required this.logsMB});

  factory StorageStatus.fromJson(Map<String, dynamic> json) {
    return StorageStatus(
      usedMB: json['usedMB'] ?? 0,
      totalMB: json['totalMB'] ?? 0,
      cacheMB: json['cacheMB'] ?? 0,
      logsMB: json['logsMB'] ?? 0,
    );
  }

  double get usagePercent => totalMB > 0 ? (usedMB / totalMB) * 100 : 0;
}

class SystemStatus {
  final int cpuPercent, memoryPercent, uptime;

  SystemStatus({required this.cpuPercent, required this.memoryPercent, required this.uptime});

  factory SystemStatus.fromJson(Map<String, dynamic> json) {
    return SystemStatus(
      cpuPercent: json['cpuPercent'] ?? 0,
      memoryPercent: json['memoryPercent'] ?? 0,
      uptime: json['uptime'] ?? 0,
    );
  }

  String get uptimeFormatted {
    final hours = uptime ~/ 3600;
    final minutes = (uptime % 3600) ~/ 60;
    return '${hours}h ${minutes}m';
  }
}

class ResourcePolicy {
  final String compression, networkMode;
  final bool cacheEnabled;
  final int maxStorageMB;

  ResourcePolicy({required this.compression, required this.cacheEnabled, required this.networkMode, required this.maxStorageMB, required this.cleanupEnabled});

  factory ResourcePolicy.fromJson(Map<String, dynamic> json) {
    return ResourcePolicy(
      compression: json['compression'] ?? 'gzip',
      cacheEnabled: json['cacheEnabled'] ?? true,
      networkMode: json['networkMode'] ?? 'Auto',
      maxStorageMB: json['maxStorageMB'] ?? 2048,
      cleanupEnabled: json['cleanupEnabled'] ?? true,
    );
  }
}

class PolicyResult {
  final ResourcePolicy policy;
  final String updatedAt;

  PolicyResult({required this.policy, required this.updatedAt});

  factory PolicyResult.fromJson(Map<String, dynamic> json) {
    return PolicyResult(policy: ResourcePolicy.fromJson(json['policy'] ?? {}), updatedAt: json['updatedAt'] ?? '');
  }
}

class CleanupResult {
  final String startedAt,? completedAt;
  final Map<String, CleanupTarget> targets;
  final int totalFreedMB;

  CleanupResult({required this.startedAt, this.completedAt, required this.targets, required this.totalFreedMB});

  factory CleanupResult.fromJson(Map<String, dynamic> json) {
    final targetsMap = <String, CleanupTarget>{};
    (json['targets'] as Map<String, dynamic>? ?? {}).forEach((k, v) => targetsMap[k] = CleanupTarget.fromJson(v));
    return CleanupResult(
      startedAt: json['startedAt'] ?? '',
      completedAt: json['completedAt'],
      targets: targetsMap,
      totalFreedMB: json['totalFreedMB'] ?? 0,
    );
  }
}

class CleanupTarget {
  final String status;
  final int freedMB;

  CleanupTarget({required this.status, required this.freedMB});

  factory CleanupTarget.fromJson(Map<String, dynamic> json) {
    return CleanupTarget(status: json['status'] ?? '', freedMB: json['freedMB'] ?? 0);
  }
}