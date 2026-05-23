import 'package:openchat_flutter/core/api/base_client.dart';

class VersionsClient extends BaseClient {
  VersionsClient({required super.baseUrl, super.token});

  Future<CurrentVersion> getCurrentVersion() async {
    final response = await dio.get('$baseUrl/api/v1/versions/current');
    return CurrentVersion.fromJson(response.data);
  }

  Future<VersionHistory> getHistory({int limit = 20}) async {
    final response = await dio.get('$baseUrl/api/v1/versions/history', queryParameters: {'limit': limit});
    return VersionHistory.fromJson(response.data);
  }

  Future<VersionDetail> getVersion(String version) async {
    final response = await dio.get('$baseUrl/api/v1/versions/$version');
    return VersionDetail.fromJson(response.data);
  }

  Future<VersionsRollbackResult> rollback(String version) async {
    final response = await dio.post('$baseUrl/api/v1/versions/$version/rollback');
    return VersionsRollbackResult.fromJson(response.data);
  }
}

class CurrentVersion {
  final String version, deployedAt, status;
  final PerformanceBaseline performance;

  CurrentVersion({required this.version, required this.deployedAt, required this.status, required this.performance});

  factory CurrentVersion.fromJson(Map<String, dynamic> json) {
    return CurrentVersion(version: json['currentVersion'] ?? '', deployedAt: json['deployedAt'] ?? '', status: json['status'] ?? '', performance: PerformanceBaseline.fromJson(json['performance'] ?? {}));
  }
}

class PerformanceBaseline {
  final int responseTime, memoryMB;

  PerformanceBaseline({required this.responseTime, required this.memoryMB});

  factory PerformanceBaseline.fromJson(Map<String, dynamic> json) {
    return PerformanceBaseline(responseTime: json['responseTime'] ?? 0, memoryMB: json['memoryMB'] ?? 0);
  }
}

class VersionHistory {
  final List<VersionDetail> versions;
  final int total;

  VersionHistory({required this.versions, required this.total});

  factory VersionHistory.fromJson(Map<String, dynamic> json) {
    return VersionHistory(versions: (json['versions'] as List? ?? []).map((v) => VersionDetail.fromJson(v)).toList(), total: json['total'] ?? 0);
  }
}

class VersionDetail {
  final String version, codeSnapshot, deployedAt, status;
  final Map<String, dynamic> configSnapshot;
  final dynamic dbSnapshot;
  final PerformanceBaseline performanceBaseline;
  final TestResults testResults;

  VersionDetail({required this.version, required this.codeSnapshot, required this.configSnapshot, this.dbSnapshot, required this.performanceBaseline, required this.testResults, required this.deployedAt, required this.status});

  factory VersionDetail.fromJson(Map<String, dynamic> json) {
    return VersionDetail(version: json['version'] ?? '', codeSnapshot: json['codeSnapshot'] ?? '', configSnapshot: Map<String, dynamic>.from(json['configSnapshot'] ?? {}), dbSnapshot: json['dbSnapshot'], performanceBaseline: PerformanceBaseline.fromJson(json['performanceBaseline'] ?? {}), testResults: TestResults.fromJson(json['testResults'] ?? {}), deployedAt: json['deployedAt'] ?? '', status: json['status'] ?? '');
  }
}

class TestResults {
  final int passed, failed;

  TestResults({required this.passed, required this.failed});

  factory TestResults.fromJson(Map<String, dynamic> json) {
    return TestResults(passed: json['passed'] ?? 0, failed: json['failed'] ?? 0);
  }

  int get total => passed + failed;
  double get passRate => total > 0 ? (passed / total) * 100 : 0;
}

class VersionsRollbackResult {
  final String rollbackId, targetVersion, status, initiatedAt;

  VersionsRollbackResult({required this.rollbackId, required this.targetVersion, required this.status, required this.initiatedAt});

  factory VersionsRollbackResult.fromJson(Map<String, dynamic> json) {
    return VersionsRollbackResult(rollbackId: json['rollbackId'] ?? '', targetVersion: json['targetVersion'] ?? '', status: json['status'] ?? '', initiatedAt: json['initiatedAt'] ?? '');
  }
}
