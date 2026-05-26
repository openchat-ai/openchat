import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sdui_engine/sdui_engine.dart';
import 'api/qiniu_direct_client.dart';

/// Qiniu-backed SDUI config source.
/// Tries: individual file → merged ui_app.json → cache → compile-time defaults.
class SduiQiniuSource extends SduiConfigSource {
  static const _maxDepth = 8;
  static const _maxChildren = 50;
  static const _allowedTypes = {
    'column', 'row', 'list', 'text', 'button', 'spacer',
    'icon', 'list_tile', 'padding', 'divider', 'image', 'card',
    'sdui_fragment', 'auto', 'checkbox', 'switch', 'textfield',
    'users_list', 's3_data', 'for_each',
  };

  static const Map<String, Map<String, dynamic>> defaults = {
    'voice': {'callingText': 'Calling {peer}...', 'connectedText': 'Connected to {peer}', 'endedText': 'Call ended', 'mutedLabel': 'MUTED', 'relayLabel': 'Qiniu relay'},
    'audio': {'mode': 'raw', 'sampleRate': 24000, 'bufferMs': 1000, 'pollMs': 800, 'fadeBytes': 240, 'fadeSamples': 48, 'demoDelayMs': 3000},
    'main': {'tabs': [{'icon': 'home', 'label': '首页', 'screen': 'home'}, {'icon': 'people', 'label': '好友', 'screen': 'people'}, {'icon': 'chat', 'label': '聊天', 'screen': 'chat'}, {'icon': 'settings', 'label': '我的', 'screen': 'settings'}]},
    'settings': {'title': 'SETTINGS', 'sections': []},
    'home': {'title': '社区动态'},
    'chat': {'title': 'Chat'},
    'agent': {'title': 'AI 居民'},
    'chat_list': {'title': 'Messages'},
    'task_detail': {'title': '任务详情'},
    'dev_ide': {'title': 'Dev Console', 'tabs': []},
    'theme_selector': {'title': '主题设置'},
    'resident_detail': {'title': '居民档案'},
    'people': {'title': '好友'},
    'global': {'spacing': {'xs': 4, 'sm': 8, 'md': 12, 'lg': 16, 'xl': 24, 'xxl': 32}, 'radius': {'sm': 8, 'md': 12, 'lg': 16, 'xl': 20}},
  };

  const SduiQiniuSource();

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

  @override
  Future<Map<String, dynamic>> load(String page) async {
    const individualPath = 'oc/config/ui_$page.json';
    final prefs = await SharedPreferences.getInstance();
    final cacheKey = 'sdui:$page';

    // 1. Individual file
    try {
      final raw = await QiniuDirectClient.fetchConfigFile(individualPath);
      if (raw != null && isValid(raw)) {
        await prefs.setString(cacheKey, jsonEncode(raw));
        return Map<String, dynamic>.from(raw);
      }
    } catch (_) {}

    // 2. Merged ui_app.json
    try {
      final appRaw = await QiniuDirectClient.fetchConfigFile('oc/config/ui_app.json');
      if (appRaw is Map && appRaw[page] is Map && isValid(appRaw[page])) {
        final data = Map<String, dynamic>.from(appRaw[page] as Map);
        await prefs.setString(cacheKey, jsonEncode(data));
        return data;
      }
    } catch (_) {}

    // 3. Cache
    final cached = prefs.getString(cacheKey);
    if (cached != null) {
      try { final p = jsonDecode(cached); if (p is Map) return Map<String, dynamic>.from(p); } catch (_) {}
    }

    // 4. Compile-time default
    return Map<String, dynamic>.from(defaults[page] ?? {});
  }

  static Future<void> clearCache() async {
    final prefs = await SharedPreferences.getInstance();
    final keys = prefs.getKeys().where((k) => k.startsWith('sdui:'));
    for (final k in keys) await prefs.remove(k);
  }
}

/// Singleton source for the app.
const sduiSource = SduiQiniuSource();

/// Convenience: load config for a page.
Future<Map<String, dynamic>> loadSdui(String page) => sduiSource.load(page);

/// App-specific mixin for ConsumerState (Riverpod).
/// Bridges the package's SduiConfigSource with Riverpod's ConsumerState.
mixin AppSduiPageState<T extends ConsumerStatefulWidget> on ConsumerState<T> {
  Map<String, dynamic> _layout = {};
  Map<String, dynamic> get sduiLayout => _layout;
  String get sduiPage => '';

  @override
  void initState() {
    super.initState();
    sduiSource.load(sduiPage).then((m) {
      if (mounted) setState(() => _layout = m);
    });
  }

  String sduiStr(String key, [String d = '']) => _layout[key] is String ? _layout[key] as String : d;
  int sduiInt(String key, [int d = 0]) => _layout[key] is int ? _layout[key] as int : d;
  double sduiNum(String key, [double d = 0]) => (_layout[key] as num?)?.toDouble() ?? d;
  List sduiList(String key) => _layout[key] is List ? _layout[key] as List : [];
  Map sduiMap(String key) => _layout[key] is Map ? _layout[key] as Map : {};
  bool sduiBool(String key, [bool d = false]) => _layout[key] is bool ? _layout[key] as bool : d;
}
