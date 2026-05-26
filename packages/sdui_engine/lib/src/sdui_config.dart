/// Abstract config loader for SDUI pages.
/// Implement this to provide configs from your backend / local storage / cache.
abstract class SduiConfigSource {
  const SduiConfigSource();
  Future<Map<String, dynamic>> load(String pageName);
}

/// In-memory config source with optional defaults.
///
/// ```dart
/// final config = SduiMemoryConfig({
///   'home': {'title': 'Home', 'items': [...]},
///   'settings': {'title': 'Settings'},
/// });
/// ```
class SduiMemoryConfig extends SduiConfigSource {
  final Map<String, Map<String, dynamic>> defaults;
  final SduiConfigSource? fallback;

  const SduiMemoryConfig(this.defaults, {this.fallback});

  @override
  Future<Map<String, dynamic>> load(String pageName) async {
    if (defaults.containsKey(pageName)) {
      return Map<String, dynamic>.from(defaults[pageName]!);
    }
    if (fallback != null) return fallback!.load(pageName);
    return {};
  }
}

/// Null-safe config source that returns empty maps (for testing).
class SduiConfigEmpty extends SduiConfigSource {
  const SduiConfigEmpty();
  @override
  Future<Map<String, dynamic>> load(String pageName) async => {};
}

/// Cascade config source: tries each source in order until one returns non-empty.
///
/// ```dart
/// final config = SduiCascadeSource([
///   SduiNetworkSource(),
///   SduiCacheSource(),
///   SduiMemoryConfig(fallbackDefaults),
/// ]);
/// ```
class SduiCascadeSource extends SduiConfigSource {
  final List<SduiConfigSource> sources;
  const SduiCascadeSource(this.sources);

  @override
  Future<Map<String, dynamic>> load(String pageName) async {
    for (final s in sources) {
      final result = await s.load(pageName);
      if (result.isNotEmpty) return result;
    }
    return {};
  }
}
