import 'package:flutter/material.dart';
import 'sdui_config.dart';

/// Mixin for ConsumerState pages to auto-load SDUI config.
///
/// Usage:
/// ```dart
/// class _MyPageState extends ConsumerState<MyPage> with SduiPageState {
///   @override String get sduiPage => 'my_page';
///   @override SduiConfigSource get configSource => mySource;
///
///   @override Widget build(BuildContext context) {
///     final title = sduiStr('title', 'Default');
///     final items = sduiList('items');
///     // ...
///   }
/// }
/// ```
mixin SduiPageState<T extends StatefulWidget> on State<T> {
  Map<String, dynamic> _layout = {};
  Map<String, dynamic> get sduiLayout => _layout;

  /// Page name used to load config (e.g. 'settings', 'home').
  String get sduiPage => '';

  /// Config source. Must be set before initState.
  SduiConfigSource get configSource => const _DefaultSource();

  @override
  void initState() {
    super.initState();
    configSource.load(sduiPage).then((m) {
      if (mounted) setState(() => _layout = m);
    });
  }

  // ─── Typed accessors ────────────────────────────────

  String sduiStr(String key, [String d = '']) => _layout[key] is String ? _layout[key] as String : d;
  int sduiInt(String key, [int d = 0]) => _layout[key] is int ? _layout[key] as int : d;
  double sduiNum(String key, [double d = 0]) => (_layout[key] as num?)?.toDouble() ?? d;
  bool sduiBool(String key, [bool d = false]) => _layout[key] is bool ? _layout[key] as bool : d;
  List sduiList(String key) => _layout[key] is List ? _layout[key] as List : [];
  Map sduiMap(String key) => _layout[key] is Map ? _layout[key] as Map : {};
}

class _DefaultSource extends SduiConfigSource {
  const _DefaultSource();
  @override
  Future<Map<String, dynamic>> load(String pageName) async => {};
}
