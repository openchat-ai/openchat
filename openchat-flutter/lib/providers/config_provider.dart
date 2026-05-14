import 'package:flutter_riverpod/flutter_riverpod.dart';

class AppConfig {
  final String baseUrl;
  final String? token;
  final bool isDev;

  AppConfig({
    this.baseUrl = 'http://localhost:3000',
    this.token,
    this.isDev = true,
  });

  AppConfig copyWith({String? baseUrl, String? token, bool? isDev}) {
    return AppConfig(
      baseUrl: baseUrl ?? this.baseUrl,
      token: token ?? this.token,
      isDev: isDev ?? this.isDev,
    );
  }
}

class ConfigNotifier extends StateNotifier<AppConfig> {
  ConfigNotifier() : super(AppConfig());

  void setBaseUrl(String url) {
    state = state.copyWith(baseUrl: url);
  }

  void setToken(String? token) {
    state = state.copyWith(token: token);
  }

  void setDevMode(bool isDev) {
    state = state.copyWith(isDev: isDev);
  }
}

final configProvider = StateNotifierProvider<ConfigNotifier, AppConfig>((ref) {
  return ConfigNotifier();
});
