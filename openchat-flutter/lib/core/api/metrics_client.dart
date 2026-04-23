import 'package:openchat_flutter/core/api/base_client.dart';

class MetricsClient extends BaseClient {
  MetricsClient({required super.baseUrl, super.token});

  Future<MetricsSummary> getSummary() async {
    final response = await dio.get('$baseUrl/api/v1/metrics');
    return MetricsSummary.fromJson(response.data);
  }

  Future<MetricsDetailed> getDetailed() async {
    final response = await dio.get('$baseUrl/api/v1/metrics/detailed');
    return MetricsDetailed.fromJson(response.data);
  }

  Future<EndpointMetrics> getEndpoints() async {
    final response = await dio.get('$baseUrl/api/v1/metrics/endpoints');
    return EndpointMetrics.fromJson(response.data);
  }

  Future<ErrorMetrics> getErrors() async {
    final response = await dio.get('$baseUrl/api/v1/metrics/errors');
    return ErrorMetrics.fromJson(response.data);
  }

  Future<ResetResult> reset() async {
    final response = await dio.post('$baseUrl/api/v1/metrics/reset');
    return ResetResult.fromJson(response.data);
  }
}

class MetricsSummary {
  final int totalRequests;
  final double avgResponseTime;
  final int activeConnections;
  final Map<String, int> requestsByMethod;
  final Map<String, int> statusCodes;

  MetricsSummary({
    required this.totalRequests,
    required this.avgResponseTime,
    required this.activeConnections,
    required this.requestsByMethod,
    required this.statusCodes,
  });

  factory MetricsSummary.fromJson(Map<String, dynamic> json) {
    return MetricsSummary(
      totalRequests: json['totalRequests'] ?? 0,
      avgResponseTime: (json['avgResponseTime'] ?? 0).toDouble(),
      activeConnections: json['activeConnections'] ?? 0,
      requestsByMethod: Map<String, int>.from(json['requestsByMethod'] ?? {}),
      statusCodes: Map<String, int>.from(json['statusCodes'] ?? {}),
    );
  }
}

class MetricsDetailed {
  final MetricsSummary summary;
  final List<EndpointStat> endpoints;
  final ErrorStats errors;
  final Map<String, dynamic> performance;

  MetricsDetailed({
    required this.summary,
    required this.endpoints,
    required this.errors,
    required this.performance,
  });

  factory MetricsDetailed.fromJson(Map<String, dynamic> json) {
    return MetricsDetailed(
      summary: MetricsSummary.fromJson(json['summary'] ?? {}),
      endpoints: (json['endpoints'] as List? ?? []).map((e) => EndpointStat.fromJson(e)).toList(),
      errors: ErrorStats.fromJson(json['errors'] ?? {}),
      performance: Map<String, dynamic>.from(json['performance'] ?? {}),
    );
  }
}

class EndpointStat {
  final String path, method;
  final int count, errorCount;
  final double avgResponseTime;

  EndpointStat({
    required this.path,
    required this.method,
    required this.count,
    required this.avgResponseTime,
    required this.errorCount,
  });

  factory EndpointStat.fromJson(Map<String, dynamic> json) {
    return EndpointStat(
      path: json['path'] ?? '',
      method: json['method'] ?? '',
      count: json['count'] ?? 0,
      avgResponseTime: (json['avgResponseTime'] ?? 0).toDouble(),
      errorCount: json['errorCount'] ?? 0,
    );
  }
}

class EndpointMetrics {
  final List<EndpointStat> endpoints;
  final int total;

  EndpointMetrics({required this.endpoints, required this.total});

  factory EndpointMetrics.fromJson(Map<String, dynamic> json) {
    return EndpointMetrics(
      endpoints: (json['endpoints'] as List? ?? []).map((e) => EndpointStat.fromJson(e)).toList(),
      total: json['total'] ?? 0,
    );
  }
}

class ErrorStats {
  final Map<String, int> byType;
  final List<RecentError> recent;

  ErrorStats({required this.byType, required this.recent});

  factory ErrorStats.fromJson(Map<String, dynamic> json) {
    return ErrorStats(
      byType: Map<String, int>.from(json['byType'] ?? {}),
      recent: (json['recent'] as List? ?? []).map((e) => RecentError.fromJson(e)).toList(),
    );
  }
}

class RecentError {
  final String type, message, endpoint, timestamp;

  RecentError({required this.type, required this.message, required this.endpoint, required this.timestamp});

  factory RecentError.fromJson(Map<String, dynamic> json) {
    return RecentError(
      type: json['type'] ?? '',
      message: json['message'] ?? '',
      endpoint: json['endpoint'] ?? '',
      timestamp: json['timestamp'] ?? '',
    );
  }
}

class ErrorMetrics {
  final Map<String, int> byType;
  final List<RecentError> recent;

  ErrorMetrics({required this.byType, required this.recent});

  factory ErrorMetrics.fromJson(Map<String, dynamic> json) {
    return ErrorMetrics(
      byType: Map<String, int>.from(json['byType'] ?? {}),
      recent: (json['recent'] as List? ?? []).map((e) => RecentError.fromJson(e)).toList(),
    );
  }
}

class ResetResult {
  final String status, timestamp;

  ResetResult({required this.status, required this.timestamp});

  factory ResetResult.fromJson(Map<String, dynamic> json) {
    return ResetResult(status: json['status'] ?? '', timestamp: json['timestamp'] ?? '');
  }
}