import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'api/qiniu_direct_client.dart';

class SduiConfig {
  static const _maxDepth = 8;
  static const _maxChildren = 50;
  static const _allowedTypes = {
    'column', 'row', 'list', 'text', 'button', 'spacer',
    'icon', 'list_tile', 'padding', 'divider', 'image', 'card',
  };

  /// Validate SDUI JSON structure to prevent malformed/crafted configs.
  static bool isValid(dynamic node, [int depth = 0]) {
    if (depth > _maxDepth) return false;
    if (node is! Map) return false;
    final type = node['type'] as String?;
    if (type == null || !_allowedTypes.contains(type)) return false;
    if (node['children'] is List) {
      final children = node['children'] as List;
      if (children.length > _maxChildren) return false;
      for (final c in children) { if (!isValid(c, depth + 1)) return false; }
    }
    if (node['child'] is Map && !isValid(node['child'], depth + 1)) return false;
    for (final k in ['content', 'title', 'subtitle', 'url']) {
      if (node[k] is String && (node[k] as String).length > 500) return false;
    }
    return true;
  }

  /// Load config with A/B testing, validation, cache, and rollback.
  /// [path] = 'oc/config/ui_settings.json'
  /// [peerId] = optional, enables A/B variant selection
  /// Returns null → caller should use hardcoded fallback.
  static Future<Map?> load(String path, {String? peerId}) async {
    final prefs = await SharedPreferences.getInstance();
    final cacheKey = 'sdui:$path';
    final versionKey = 'sdui_ver:$path';

    Future<Map?> _fetch(String p) async {
      try {
        final raw = await QiniuDirectClient.fetchConfigFile(p);
        if (raw != null && isValid(raw)) {
          await prefs.setString(cacheKey, jsonEncode(raw));
          await prefs.setString(versionKey, raw['version']?.toString() ?? '1');
          return raw;
        }
      } catch (_) {}
      return null;
    }

    // 1. A/B variant (only if peerId available)
    if (peerId != null) {
      final variant = peerId.hashCode % 10 < 5 ? 'a' : 'b';
      final vp = path.replaceFirst('.json', '_$variant.json');
      final result = await _fetch(vp);
      if (result != null) return result;
    }

    // 2. Default path
    final result = await _fetch(path);
    if (result != null) return result;

    // 3. Rollback: last cached config
    final cached = prefs.getString(cacheKey);
    if (cached != null) {
      try { final p = jsonDecode(cached); if (p is Map) return p; } catch (_) {}
    }

    // 4. No valid config → hardcoded fallback
    return null;
  }

  /// Clear cached configs (for testing / forced refresh)
  static Future<void> clearCache() async {
    final prefs = await SharedPreferences.getInstance();
    final keys = prefs.getKeys().where((k) => k.startsWith('sdui:'));
    for (final k in keys) await prefs.remove(k);
  }
}
