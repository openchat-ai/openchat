import 'package:flutter_riverpod/flutter_riverpod.dart';

class AppConfig {
  final String baseUrl;
  final String? token;
  final bool isDev;
  final bool agentDebug;

  AppConfig({
    this.baseUrl = 'http://localhost:3800',
    this.token,
    this.isDev = true,
    this.agentDebug = false,
  });

  AppConfig copyWith({String? baseUrl, String? token, bool? isDev, bool? agentDebug}) {
    return AppConfig(
      baseUrl: baseUrl ?? this.baseUrl,
      token: token ?? this.token,
      isDev: isDev ?? this.isDev,
      agentDebug: agentDebug ?? this.agentDebug,
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

  void setAgentDebug(bool on) {
    state = state.copyWith(agentDebug: on);
  }
}

final configProvider = StateNotifierProvider<ConfigNotifier, AppConfig>((ref) {
  return ConfigNotifier();
});
