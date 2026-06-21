import 'dart:convert';
import 'dart:developer' show log;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sdui_engine/sdui_engine.dart';
export 'package:sdui_engine/sdui_engine.dart';
export 'theme/app_theme.dart';
import 'api/qiniu_direct_client.dart';
import 'theme/app_theme.dart';

const appVersion = 'v0.2.0-alpha';

/// ===== sdui_config.dart (original) =====
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
    'audio': {'sampleRate': 48000, 'bufferMs': 1000, 'pollMs': 800, 'fadeBytes': 240, 'fadeSamples': 48, 'demoDelayMs': 3000},
    'main': {'tabs': [{'icon': 'home', 'label': 'Home', 'screen': 'home'}, {'icon': 'plan', 'label': 'Plan', 'screen': 'plan'}, {'icon': 'agent', 'label': 'Agent', 'screen': 'agent'}, {'icon': 'chat', 'label': 'Chat', 'screen': 'chat'}, {'icon': 'dev', 'label': 'Dev', 'screen': 'dev'}, {'icon': 'settings', 'label': 'Settings', 'screen': 'settings'}], 'fab': {'icon': 'palette', 'action': 'theme', 'hidden': false}, 'navBarHeight': 80},
    'settings': {'title': 'SETTINGS', 'sections': []}, 'home': {'title': '社区动态'}, 'chat': {'title': 'Chat'},
    'agent': {'title': 'AI 居民'}, 'plan': {'title': 'Plan'}, 'chat_list': {'title': 'Messages'},
    'task_detail': {'title': '任务详情'}, 'dev_ide': {'title': 'Dev Console', 'tabs': [
      {'label': 'Console', 'type': 'logs'},
      {'label': 'Debug', 'type': 'sdui', 'content': {'type': 'column', 'children': [
        {'type': 'text', 'content': 'Enter a command below', 'pad': 16},
        {'type': 'textfield', 'hint': 'Type command...', 'action': 'exec_cmd', 'pad': 16},
        {'type': 'text', 'content': 'test_put / test_get / s3_upload / form_upload', 'style': {'size': 12, 'color': '#9E9E9E'}, 'pad': 8},
      ]}},
    ]},
    'theme_selector': {'title': '主题设置'}, 'resident_detail': {'title': '居民档案'}, 'people': {'title': '好友'},
    'global': {'spacing': {'xs': 4, 'sm': 8, 'md': 12, 'lg': 16, 'xl': 24, 'xxl': 32}, 'radius': {'sm': 8, 'md': 12, 'lg': 16, 'xl': 20}},
  };

  const SduiQiniuSource();

  static bool isValid(dynamic node, [int depth = 0]) {
    if (depth > _maxDepth) return false;
    if (node is! Map) return false;
    final type = node['type'] as String?;
    if (type == null || !_allowedTypes.contains(type)) return false;
    if (node['children'] is List) { final children = node['children'] as List; if (children.length > _maxChildren) return false; for (final c in children) { if (!isValid(c, depth + 1)) return false; } }
    if (node['child'] is Map && !isValid(node['child'], depth + 1)) return false;
    for (final k in ['content', 'title', 'subtitle', 'url']) { if (node[k] is String && (node[k] as String).length > 500) return false; }
    return true;
  }

  @override
  Future<Map<String, dynamic>> load(String page) async {
    log('[C18] sdui load page=$page');
    final individualPath = 'oc/config/ui_$page.json';
    final prefs = await SharedPreferences.getInstance();
    final cacheKey = 'sdui:$page';

    try { final raw = await QiniuDirectClient.fetchConfigFile(individualPath); if (raw != null && isValid(raw)) { await prefs.setString(cacheKey, jsonEncode(raw)); return Map<String, dynamic>.from(raw); } } catch (_) {}
    try { final appRaw = await QiniuDirectClient.fetchConfigFile('oc/config/ui_app.json'); if (appRaw is Map && appRaw[page] is Map && isValid(appRaw[page])) { final data = Map<String, dynamic>.from(appRaw[page] as Map); await prefs.setString(cacheKey, jsonEncode(data)); return data; } } catch (_) {}
    final cached = prefs.getString(cacheKey);
    if (cached != null) { try { final p = jsonDecode(cached); if (p is Map) return Map<String, dynamic>.from(p); } catch (_) {} }
    return Map<String, dynamic>.from(defaults[page] ?? {});
  }

  static Future<void> clearCache() async { final prefs = await SharedPreferences.getInstance(); final keys = prefs.getKeys().where((k) => k.startsWith('sdui:')); for (final k in keys) await prefs.remove(k); }
}

const sduiSource = SduiQiniuSource();

/// ===== sdui_fragment.dart =====
class SduiFragmentWidget extends StatefulWidget {
  final String path;
  final void Function(String action)? onAction;
  const SduiFragmentWidget({required this.path, this.onAction, super.key});
  @override State<SduiFragmentWidget> createState() => _SduiFragmentWidgetState();
}

class _SduiFragmentWidgetState extends State<SduiFragmentWidget> {
  Map? _data;
  @override void initState() { super.initState(); _load(); }
  @override void didUpdateWidget(SduiFragmentWidget old) { super.didUpdateWidget(old); if (old.path != widget.path) _load(); }
  Future<void> _load() async { final raw = await QiniuDirectClient.fetchConfigFile(widget.path); if (mounted && raw != null) setState(() => _data = raw); }
  @override Widget build(BuildContext context) { if (_data == null) return const SizedBox(height: 1); return SduiParser(onAction: widget.onAction).parse(_data) ?? const SizedBox(); }
}

/// ===== sdui_actions.dart =====
class SduiActions {
  static void handle(BuildContext context, String action, {VoidCallback? onRefresh, VoidCallback? onDemo, Map<String, VoidCallback>? custom}) {
    log('[C19] sdui action=$action');
    if (action == 'refresh') { onRefresh?.call(); return; }
    if (action == 'demo') { onDemo?.call(); return; }
    if (action.startsWith('navigate:')) { final path = action.substring(9); final parts = path.split('?'); final route = parts[0]; Map<String, dynamic>? args; if (parts.length > 1) { args = {}; for (final param in parts[1].split('&')) { final kv = param.split('='); if (kv.length == 2) args[kv[0]] = Uri.decodeComponent(kv[1]); } } Navigator.pushNamed(context, route, arguments: args); }
    if (action.startsWith('snackbar:')) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(action.substring(9)))); return; }
    if (action.startsWith('sdui_dialog:')) { final encoded = action.substring(12); try { final layout = jsonDecode(utf8.decode(base64Decode(encoded))); if (layout is Map) { showDialog(context: context, builder: (ctx) => AlertDialog(content: SizedBox(width: double.maxFinite, child: SduiParser(onAction: (a) { Navigator.pop(ctx); }).parse(layout)))); } } catch (_) {} return; }
    if (action.startsWith('dialog:')) { final parts = action.substring(7).split('|'); showDialog(context: context, builder: (ctx) => AlertDialog(title: Text(parts[0]), content: parts.length > 1 ? Text(parts[1]) : null, actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK'))])); return; }
    if (action.startsWith('haptic:')) { return; }
    if (action.startsWith('tel:') || action.startsWith('mailto:')) { Clipboard.setData(ClipboardData(text: action.substring(4))); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Copied: ${action.substring(4)}'))); return; }
    if (action.startsWith('http://') || action.startsWith('https://')) { Clipboard.setData(ClipboardData(text: action)); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Link copied'))); return; }
    if (custom?[action] != null) { custom![action]!(); return; }
  }
}

/// ===== sdui_style.dart =====
class SduiStyle {
  static double sp(String key, [double d = 12]) => QiniuDirectClient.spacing(key, d);
  static double rd(String key, [double d = 12]) => QiniuDirectClient.radius(key, d);
  static Widget sectionHeader(String text, AppTheme theme) { final size = QiniuDirectClient.globalStyle['sectionHeaderSize'] as num? ?? 16; return Text(text, style: TextStyle(color: theme.textPrimary, fontSize: size.toDouble(), fontWeight: FontWeight.w600)); }
  static Widget bodyText(String text, AppTheme theme, {double size = 13}) { return Text(text, style: TextStyle(color: theme.textSecondary, fontSize: size)); }
  static Widget caption(String text, AppTheme theme, {double size = 11}) { return Text(text, style: TextStyle(color: theme.textTertiary, fontSize: size)); }
  static Container sectionContainer(Widget child, AppTheme theme) { final pad = sp('md', 16); final r = rd('md', 12); return Container(padding: EdgeInsets.all(pad), decoration: BoxDecoration(color: theme.surface.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(r), border: Border.all(color: theme.textTertiary.withValues(alpha: 0.1))), child: child); }
  static EdgeInsets sectionPadding = EdgeInsets.fromLTRB(20, 8, 20, 8);
  static double vGap(String key, [double d = 12]) => sp(key, d);
}

/// ===== ui_voice_config.dart =====
class VoiceUiConfig {
  final Map<String, dynamic> raw;
  const VoiceUiConfig([this.raw = const {}]);
  String getString(String key, String def) => raw[key] is String ? raw[key] as String : def;
  String get callingText => getString('callingText', 'Calling {peer}...');
  String get ringingText => getString('ringingText', 'Incoming call...');
  String get connectedText => getString('connectedText', 'Connected to {peer}');
  String get endedText => getString('endedText', 'Call ended');
  String get mutedLabel => getString('mutedLabel', 'MUTED');
  String get relayLabel => getString('relayLabel', 'Qiniu relay');
  String get incomingTitle => getString('incomingTitle', 'Incoming Call');
  String get incomingBody => getString('incomingBody', '{peer} is calling...');
  String get acceptLabel => getString('acceptLabel', 'Accept');
  String get declineLabel => getString('declineLabel', 'Decline');
  String calling(String peer) => callingText.replaceAll('{peer}', peer);
  String connected(String peer) => connectedText.replaceAll('{peer}', peer);
  String incomingBody_(String peer) => incomingBody.replaceAll('{peer}', peer);
  static Future<VoiceUiConfig> load() async { try { final raw = await QiniuDirectClient.fetchConfigFile('oc/config/ui_voice.json'); if (raw == null) return const VoiceUiConfig(); return VoiceUiConfig(Map<String, dynamic>.from(raw)); } catch (e) { log('VoiceUiConfig.load error: $e'); return const VoiceUiConfig(); } }
}
