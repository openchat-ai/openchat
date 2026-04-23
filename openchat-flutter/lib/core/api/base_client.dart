import 'package:dio/dio.dart';

class BaseClient {
  late final Dio _dio;
  final String baseUrl;
  String? _token;

  BaseClient({
    required this.baseUrl,
    String? token,
    Dio? dio,
  }) {
    _token = token;
    _dio = dio ?? _createDio();
  }

  Dio _createDio() {
    final dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 30),
      headers: {
        'Content-Type': 'application/json',
        if (_token != null) 'Authorization': 'Bearer $_token',
      },
    ));

    dio.interceptors.add(InterceptorsWrapper(
      onError: (error, handler) async {
        if (error.response?.statusCode == 429) {
          // 从响应体读取 retryAfter（服务端放在 JSON 里）
          final data = error.response?.data as Map<String, dynamic>?;
          final retryAfter = data?['retryAfter'] as int?;
          
          if (retryAfter != null) {
            await Future.delayed(Duration(seconds: retryAfter));
            final options = error.requestOptions;
            options.headers['Authorization'] = 'Bearer $_token';
            try {
              final response = await _dio.fetch(options);
              handler.resolve(response);
              return;
            } catch (e) {
              handler.reject(error);
              return;
            }
          }
        }
        handler.next(error);
      },
    ));

    return dio;
  }

  void setToken(String? token) {
    _token = token;
  }

  Dio get dio => _dio;
}