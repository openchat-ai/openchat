import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/api/base_client.dart';
import '../core/models/agent_model.dart';
import '../core/models/resident_model.dart';
import '../core/theme/app_theme.dart';

// ===== config_provider.dart =====
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

  void setBaseUrl(String url) { state = state.copyWith(baseUrl: url); }
  void setToken(String? token) { state = state.copyWith(token: token); }
  void setDevMode(bool isDev) { state = state.copyWith(isDev: isDev); }
  void setAgentDebug(bool on) { state = state.copyWith(agentDebug: on); }
}

final configProvider = StateNotifierProvider<ConfigNotifier, AppConfig>((ref) => ConfigNotifier());

// ===== client_providers.dart =====
final agentClientProvider = Provider<AgentClient>((ref) {
  final config = ref.watch(configProvider);
  return AgentClient(baseUrl: config.baseUrl, token: config.token);
});
final metricsClientProvider = Provider<MetricsClient>((ref) {
  final config = ref.watch(configProvider);
  return MetricsClient(baseUrl: config.baseUrl, token: config.token);
});
final resourcesClientProvider = Provider<ResourcesClient>((ref) {
  final config = ref.watch(configProvider);
  return ResourcesClient(baseUrl: config.baseUrl, token: config.token);
});
final p2pClientProvider = Provider<P2PClient>((ref) {
  final config = ref.watch(configProvider);
  return P2PClient(baseUrl: config.baseUrl, token: config.token);
});
final skillsClientProvider = Provider<SkillsClient>((ref) {
  final config = ref.watch(configProvider);
  return SkillsClient(baseUrl: config.baseUrl, token: config.token);
});
final feedbackClientProvider = Provider<FeedbackClient>((ref) {
  final config = ref.watch(configProvider);
  return FeedbackClient(baseUrl: config.baseUrl, token: config.token);
});
final decisionsClientProvider = Provider<DecisionsClient>((ref) {
  final config = ref.watch(configProvider);
  return DecisionsClient(baseUrl: config.baseUrl, token: config.token);
});
final updatesClientProvider = Provider<UpdatesClient>((ref) {
  final config = ref.watch(configProvider);
  return UpdatesClient(baseUrl: config.baseUrl, token: config.token);
});
final versionsClientProvider = Provider<VersionsClient>((ref) {
  final config = ref.watch(configProvider);
  return VersionsClient(baseUrl: config.baseUrl, token: config.token);
});
final residentClientProvider = Provider<ResidentClient>((ref) {
  final config = ref.watch(configProvider);
  return ResidentClient(baseUrl: config.baseUrl, token: config.token);
});
final sageClientProvider = Provider<SageClient>((ref) {
  final config = ref.watch(configProvider);
  return SageClient(baseUrl: config.baseUrl, token: config.token);
});

// ===== bridge_provider.dart =====
final bridgeWsProvider = Provider<BridgeWsClient>((ref) {
  final config = ref.watch(configProvider);
  final uri = Uri.parse(config.baseUrl);
  final client = BridgeWsClient(host: uri.host, port: uri.port);
  if (config.token != null) client.configure(token: config.token);
  client.connect();
  ref.onDispose(() => client.dispose());
  return client;
});

final bridgeConnectionProvider = StreamProvider<WsConnectionInfo>((ref) {
  final client = ref.watch(bridgeWsProvider);
  return client.connectionState;
});

final bridgeConnectedProvider = Provider<bool>((ref) {
  final info = ref.watch(bridgeConnectionProvider);
  return info.valueOrNull?.state == WsConnectionState.connected;
});

// ===== agent_provider.dart =====
class AgentNotifier extends StateNotifier<AsyncValue<List<Agent>>> {
  final AgentClient _client;
  Timer? _pollTimer;

  AgentNotifier(this._client) : super(const AsyncValue.loading()) {
    refreshAgents();
  }

  Future<void> refreshAgents() async {
    state = const AsyncValue.loading();
    try {
      final agents = await _client.getAgents();
      state = AsyncValue.data(agents);
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }

  Future<void> spawnAgent({required String role, String? name, String? task}) async {
    try {
      final newAgent = await _client.createAgent(role: role, name: name, task: task);
      final currentAgents = state.value ?? [];
      state = AsyncValue.data([...currentAgents, newAgent]);
      _startPolling(newAgent.id);
    } catch (e) {
      state = AsyncValue.error(e, StackTrace.current);
    }
  }

  Future<void> stopAgent(String id) async {
    try {
      await _client.terminateAgent(id);
      final currentAgents = state.value ?? [];
      state = AsyncValue.data(currentAgents.where((a) => a.id != id).toList());
    } catch (e) {
      debugPrint('Error terminating agent: $e');
    }
  }

  void _startPolling(String agentId) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (timer) async {
      try {
        final updatedAgent = await _client.getAgentDetails(agentId);
        if (updatedAgent.status == AgentStatus.completed ||
            updatedAgent.status == AgentStatus.failed ||
            updatedAgent.status == AgentStatus.terminated) {
          timer.cancel();
        }
        final currentAgents = state.value ?? [];
        final updatedList = currentAgents.map((a) => a.id == agentId ? updatedAgent : a).toList();
        state = AsyncValue.data(updatedList);
      } catch (e) {
        debugPrint('Polling error for agent $agentId: $e');
      }
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }
}

final agentProvider = StateNotifierProvider<AgentNotifier, AsyncValue<List<Agent>>>((ref) {
  return AgentNotifier(ref.watch(agentClientProvider));
});

// ===== feed_provider.dart =====
class FeedNotifier extends StateNotifier<AsyncValue<List<FeedItem>>> {
  final ResidentClient _client;

  FeedNotifier(this._client) : super(const AsyncValue.loading()) { refresh(); }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    try {
      final feed = await _client.getCommunityFeed();
      state = AsyncValue.data(feed);
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }
}

final feedProvider = StateNotifierProvider<FeedNotifier, AsyncValue<List<FeedItem>>>((ref) {
  final client = ref.watch(residentClientProvider);
  return FeedNotifier(client);
});

// ===== resident_provider.dart =====
class ResidentNotifier extends StateNotifier<AsyncValue<List<Resident>>> {
  final ResidentClient _residentClient;
  final AgentClient _agentClient;

  ResidentNotifier(this._residentClient, this._agentClient) : super(const AsyncValue.loading()) { refresh(); }

  Future<void> refresh({String? status}) async {
    state = const AsyncValue.loading();
    try {
      final residents = await _residentClient.getResidents(status: status);
      state = AsyncValue.data(residents);
    } catch (e, stack) {
      state = AsyncValue.error(e, stack);
    }
  }

  Future<Resident?> create({String? name, int? parentId}) async {
    try {
      final resident = await _residentClient.createResident(name: name, parentId: parentId);
      final currentList = state.value ?? [];
      state = AsyncValue.data([resident, ...currentList]);
      return resident;
    } catch (e) {
      debugPrint('Error creating resident: $e');
      return null;
    }
  }

  Future<void> delete(int id) async {
    try {
      await _residentClient.deleteResident(id);
      final currentList = state.value ?? [];
      state = AsyncValue.data(currentList.where((r) => r.id != id).toList());
    } catch (e) {
      debugPrint('Error deleting resident: $e');
    }
  }

  Future<Resident> getDetail(int id) async => await _residentClient.getResidentDetail(id);
  Future<List<ChildSummary>> getChildren(int id) async => await _residentClient.getChildren(id);

  Future<List<Agent>> getAgents(int residentId, {String? status}) async {
    return await _agentClient.getAgents(residentId: residentId, status: status);
  }

  Future<Agent?> createAgent({required int residentId, required String role, String? name, String? task}) async {
    try {
      return await _agentClient.createAgent(role: role, name: name, task: task, residentId: residentId);
    } catch (e) {
      debugPrint('Error creating agent for resident: $e');
      return null;
    }
  }

  Future<void> terminateAgent(String agentId) async {
    try {
      await _agentClient.terminateAgent(agentId);
    } catch (e) {
      debugPrint('Error terminating agent: $e');
    }
  }
}

final residentProvider = StateNotifierProvider<ResidentNotifier, AsyncValue<List<Resident>>>((ref) {
  final residentClient = ref.watch(residentClientProvider);
  final agentClient = ref.watch(agentClientProvider);
  return ResidentNotifier(residentClient, agentClient);
});

// ===== sage_provider.dart =====
class SageNotifier extends StateNotifier<AsyncValue<List<SageRecord>>> {
  final SageClient _sageClient;
  int? _currentResidentId;

  SageNotifier(this._sageClient) : super(const AsyncValue.data([]));

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

  Future<SageRecord?> answer(int residentId, String recordId, String content) async {
    try {
      final record = await _sageClient.answer(residentId, recordId, content);
      if (_currentResidentId == residentId) await loadConversation(residentId);
      return record;
    } catch (e) {
      debugPrint('Error answering sage question: $e');
      return null;
    }
  }

  Future<SageRecord?> guide(int residentId, String content, String type) async {
    try {
      final record = await _sageClient.guide(residentId, content, type);
      if (_currentResidentId == residentId) await loadConversation(residentId);
      return record;
    } catch (e) {
      debugPrint('Error guiding resident: $e');
      return null;
    }
  }

  Future<void> refresh() async {
    if (_currentResidentId != null) await loadConversation(_currentResidentId!);
  }
}

final sageProvider = StateNotifierProvider<SageNotifier, AsyncValue<List<SageRecord>>>((ref) {
  final sageClient = ref.watch(sageClientProvider);
  return SageNotifier(sageClient);
});

// ===== theme_provider.dart =====
enum ThemeModeSetting { auto, light, dark, manual }

final themeModeProvider = StateProvider<ThemeModeSetting>((ref) => ThemeModeSetting.manual);
final currentThemeIndexProvider = StateProvider<int>((ref) => 0);
final systemBrightnessProvider = StateProvider<Brightness>((ref) => Brightness.light);

final isDarkModeProvider = Provider<bool>((ref) {
  final themeMode = ref.watch(themeModeProvider);
  final systemBrightness = ref.watch(systemBrightnessProvider);
  switch (themeMode) {
    case ThemeModeSetting.auto: return systemBrightness == Brightness.dark;
    case ThemeModeSetting.dark: return true;
    case ThemeModeSetting.light:
    case ThemeModeSetting.manual: return false;
  }
});

final currentThemeProvider = Provider<AppTheme>((ref) {
  final themeMode = ref.watch(themeModeProvider);
  final themeIndex = ref.watch(currentThemeIndexProvider);
  final isDark = ref.watch(isDarkModeProvider);
  if (themeMode == ThemeModeSetting.auto || themeMode == ThemeModeSetting.dark || themeMode == ThemeModeSetting.light) {
    return isDark ? AppTheme.glassmorphism : AppTheme.minimalZen;
  }
  return AppTheme.all[themeIndex];
});

ThemeData buildThemeData(AppTheme theme) {
  final isDark = theme.background.computeLuminance() < 0.5;
  return ThemeData(
    useMaterial3: true,
    brightness: isDark ? Brightness.dark : Brightness.light,
    scaffoldBackgroundColor: theme.background,
    primaryColor: theme.primary,
    colorScheme: ColorScheme(
      brightness: isDark ? Brightness.dark : Brightness.light,
      primary: theme.primary, secondary: theme.secondary,
      surface: theme.surface, error: theme.error,
      onPrimary: theme.textPrimary, onSecondary: theme.textPrimary,
      onSurface: theme.textPrimary, onError: Colors.white,
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.transparent, elevation: 0, centerTitle: false,
      titleTextStyle: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: theme.textPrimary,
        letterSpacing: theme.style == ThemeStyle.retroWave ? 4 : 1),
      iconTheme: IconThemeData(color: theme.textSecondary),
    ),
    cardTheme: CardThemeData(
      color: theme.surface.withValues(alpha: 0.5), elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(theme.radiusMedium)),
    ),
    bottomNavigationBarTheme: BottomNavigationBarThemeData(
      backgroundColor: Colors.transparent, elevation: 0, type: BottomNavigationBarType.fixed,
      selectedItemColor: theme.primary, unselectedItemColor: theme.textTertiary,
    ),
    textTheme: TextTheme(
      headlineLarge: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: theme.textPrimary, letterSpacing: -0.5),
      headlineMedium: TextStyle(fontSize: 24, fontWeight: FontWeight.w600, color: theme.textPrimary),
      bodyLarge: TextStyle(fontSize: 16, color: theme.textPrimary),
      bodyMedium: TextStyle(fontSize: 14, color: theme.textSecondary),
      bodySmall: TextStyle(fontSize: 12, color: theme.textTertiary),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: theme.surface.withValues(alpha: 0.5),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(theme.radiusMedium), borderSide: BorderSide.none),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    ),
  );
}
