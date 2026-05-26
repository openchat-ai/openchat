import 'package:flutter/material.dart';
import 'sdui_config.dart';

/// Global default config source. Set once at app startup.
SduiConfigSource? _globalSource;

/// Mixin for any State pages to auto-load SDUI config.
/// Works with both plain `State` and Riverpod's `ConsumerState`.
///
/// ```dart
/// // App startup:
/// SduiPageState.defaultSource = myConfigSource;
///
/// // Page:
/// class _MyPageState extends State<MyPage> with SduiPageState {
///   @override String get sduiPage => 'my_page';
///   // sduiLayout, sduiStr(), sduiList() ready after initState
/// }
/// ```
mixin SduiPageState<T extends StatefulWidget> on State<T> {
  static SduiConfigSource? defaultSource;

  Map<String, dynamic> _layout = {};
  Map<String, dynamic> get sduiLayout => _layout;
  String get sduiPage => '';

  SduiConfigSource? get configSource => null;

  @override
  void initState() {
    super.initState();
    final source = configSource ?? defaultSource ?? const _EmptySource();
    source.load(sduiPage).then((m) {
      if (mounted) setState(() => _layout = m);
    });
  }

  String sduiStr(String key, [String d = '']) => _layout[key] is String ? _layout[key] as String : d;
  int sduiInt(String key, [int d = 0]) => _layout[key] is int ? _layout[key] as int : d;
  double sduiNum(String key, [double d = 0]) => (_layout[key] as num?)?.toDouble() ?? d;
  bool sduiBool(String key, [bool d = false]) => _layout[key] is bool ? _layout[key] as bool : d;
  List sduiList(String key) => _layout[key] is List ? _layout[key] as List : [];
  Map sduiMap(String key) => _layout[key] is Map ? _layout[key] as Map : {};
}

class _EmptySource extends SduiConfigSource {
  const _EmptySource();
  @override
  Future<Map<String, dynamic>> load(String pageName) async => {};
}
