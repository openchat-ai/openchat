/// Abstract config loader for SDUI pages.
/// Implement this to provide configs from your backend / local storage / cache.
abstract class SduiConfigSource {
  const SduiConfigSource();
  Future<Map<String, dynamic>> load(String pageName);
}

/// Null-safe config source that returns empty maps (for testing).
class SduiConfigEmpty extends SduiConfigSource {
  const SduiConfigEmpty();
  @override
  Future<Map<String, dynamic>> load(String pageName) async => {};
}
