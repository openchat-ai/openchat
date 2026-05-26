import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'api/qiniu_direct_client.dart';

class SduiConfig {
  static const _maxDepth = 8;
  static const _maxChildren = 50;
  static const _allowedTypes = {
    'column', 'row', 'list', 'text', 'button', 'spacer',
    'icon', 'list_tile', 'padding', 'divider', 'image', 'card',
    'sdui_fragment', 'auto', 'checkbox', 'switch', 'textfield',
    'users_list', 's3_data', 'for_each',
  };

  /// Compile-time default configs (used when network is unavailable).
  /// Each entry is a [pageName] → default Map.
  static const Map<String, Map<String, dynamic>> defaults = {
    'ui_voice': {'callingText': 'Calling {peer}...', 'connectedText': 'Connected to {peer}', 'endedText': 'Call ended', 'mutedLabel': 'MUTED', 'relayLabel': 'Qiniu relay'},
    'ui_audio': {'mode': 'raw', 'sampleRate': 24000, 'bufferMs': 1000, 'pollMs': 800, 'fadeBytes': 240, 'fadeSamples': 48, 'demoDelayMs': 3000},
    'ui_main': {'tabs': [{'icon': 'home', 'label': '首页', 'screen': 'home'}, {'icon': 'people', 'label': '好友', 'screen': 'people'}, {'icon': 'chat', 'label': '聊天', 'screen': 'chat'}, {'icon': 'settings', 'label': '我的', 'screen': 'settings'}]},
    'ui_settings': {'title': 'SETTINGS', 'sections': []},
    'ui_home': {'title': '社区动态'},
    'ui_chat': {'title': 'Chat'},
    'ui_agent': {'title': 'AI 居民'},
    'ui_chat_list': {'title': 'Messages'},
    'ui_task_detail': {'title': '任务详情'},
    'ui_dev_ide': {'title': 'Dev Console', 'tabs': []},
    'ui_theme_selector': {'title': '主题设置'},
    'ui_resident_detail': {'title': '居民档案'},
    'global': {'spacing': {'xs': 4, 'sm': 8, 'md': 12, 'lg': 16, 'xl': 24, 'xxl': 32}, 'radius': {'sm': 8, 'md': 12, 'lg': 16, 'xl': 20}},
  };

  /// Get default config for a page name.
  static Map<String, dynamic> defaultFor(String page) => Map<String, dynamic>.from(defaults[page] ?? {});

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

  /// Unified load: tries ui_app.json[page] → ui_{page}.json → compile-time default.
  /// [page] = 'settings', 'home', 'agent', etc. (without 'ui_' prefix).
  static Future<Map<String, dynamic>> load(String page) async {
    const individualPath = 'oc/config/ui_$page.json';
    final prefs = await SharedPreferences.getInstance();
    final cacheKey = 'sdui:$page';

    // Try individual file first (fast path)
    try {
      final raw = await QiniuDirectClient.fetchConfigFile(individualPath);
      if (raw != null && isValid(raw)) {
        await prefs.setString(cacheKey, jsonEncode(raw));
        return Map<String, dynamic>.from(raw);
      }
    } catch (_) {}

    // Fallback: merged ui_app.json
    try {
      final appRaw = await QiniuDirectClient.fetchConfigFile('oc/config/ui_app.json');
      if (appRaw is Map && appRaw[page] is Map && isValid(appRaw[page])) {
        final data = Map<String, dynamic>.from(appRaw[page] as Map);
        await prefs.setString(cacheKey, jsonEncode(data));
        return data;
      }
    } catch (_) {}

    // Rollback: cached
    final cached = prefs.getString(cacheKey);
    if (cached != null) {
      try { final p = jsonDecode(cached); if (p is Map) return Map<String, dynamic>.from(p); } catch (_) {}
    }

    // Fallback: compile-time default
    return defaultFor(page);
  }

  static Future<void> clearCache() async {
    final prefs = await SharedPreferences.getInstance();
    final keys = prefs.getKeys().where((k) => k.startsWith('sdui:'));
    for (final k in keys) await prefs.remove(k);
  }
}
