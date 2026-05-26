import 'package:flutter/material.dart';
import 'package:sdui_engine/sdui_engine.dart';

void main() {
  SduiStyle.init({
    'spacing': {'xs': 4, 'sm': 8, 'md': 12, 'lg': 16, 'xl': 24, 'xxl': 32},
    'radius': {'sm': 8, 'md': 12, 'lg': 16, 'xl': 20},
    'sectionHeaderSize': 16,
  });
  runApp(const SduiDemoApp());
}

class SduiDemoApp extends StatelessWidget {
  const SduiDemoApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'SDUI Engine',
    theme: ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorSchemeSeed: const Color(0xFF6366F1),
    ),
    initialRoute: '/',
    routes: {
      '/': (context) => const HomePage(),
      '/page': (context) => const PageDemo(),
    },
  );
}

// ─── Home: Inline JSON demo ──────────────────────────────

class HomePage extends StatefulWidget {
  const HomePage({super.key});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  int _counter = 0;
  final _users = [
    {'name': 'Alice', 'role': 'Engineer'},
    {'name': 'Bob', 'role': 'Designer'},
    {'name': 'Charlie', 'role': 'Product Manager'},
  ];

  @override
  Widget build(BuildContext context) {
    final layout = {
      'type': 'column',
      'center': true,
      'children': [
        {'type': 'text', 'content': 'SDUI Engine', 'style': {'size': 28, 'bold': true}, 'pad': 16},
        {'type': 'icon', 'icon': 'code', 'size': 72, 'color': '#6366F1'},
        {'type': 'text', 'content': 'Server-Driven UI for Flutter', 'style': {'size': 14}, 'pad': 8},
        {'type': 'divider'},
        {'type': 'text', 'content': 'Clicked $_counter times', 'pad': 8, 'style': {'size': 14}},
        {'type': 'button', 'content': 'Tap me', 'action': 'increment', 'color': '#6366F1'},
        {'type': 'divider'},
        {'type': 'text', 'content': 'Dynamic List Demo', 'style': {'size': 16, 'bold': true}, 'pad': 16},
        {'type': 'for_each', 'items': 'users', 'template': {
          'type': 'card', 'padding': 12, 'margin': 4, 'child': {
            'type': 'row', 'children': [
              {'type': 'icon', 'icon': 'person', 'size': 24, 'color': '#6366F1', 'containerSize': 40, 'radius': 20, 'bgColor': '#6366F120'},
              {'type': 'text', 'content': '  {{name}} — {{role}}', 'flex': 1},
            ],
          },
        }},
        {'type': 'spacer'},
        {'type': 'button', 'content': 'Open SduiPage Demo →', 'action': 'navigate', 'pad': 16},
        const SizedBox(height: 24),
      ],
    };

    return Scaffold(
      appBar: AppBar(title: const Text('SDUI Engine Demo')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: SduiParser(
          onAction: (action) {
            if (action == 'increment') setState(() => _counter++);
            if (action == 'navigate') Navigator.pushNamed(context, '/page');
          },
          vars: {'users': _users, 'counter': _counter},
        ).parse(layout),
      ),
    );
  }
}

// ─── Page demo with SduiPageState mixin ──────────────────

class PageDemo extends StatefulWidget {
  const PageDemo({super.key});
  @override
  State<PageDemo> createState() => _PageDemoState();
}

class _PageDemoState extends State<PageDemo> with SduiPageState {
  @override
  String get sduiPage => 'demo';

  @override
  SduiConfigSource get configSource => SduiMemoryConfig({
    'demo': {
      'title': 'SDUI Page Demo',
      'body': {
        'type': 'column', 'center': true, 'children': [
          {'type': 'icon', 'icon': 'check_circle', 'size': 64, 'color': '#22C55E'},
          {'type': 'text', 'content': 'SduiPageState loaded your config', 'style': {'size': 18, 'bold': true}, 'pad': 16},
          {'type': 'card', 'gradient': ['#6366F120', '#22C55E10'], 'radius': 16, 'padding': 20, 'child': {
            'type': 'column', 'children': [
              {'type': 'text', 'content': 'Config sources are pluggable:', 'style': {'size': 14}, 'pad': 4},
              {'type': 'text', 'content': '• Network API → Cache → Fallback', 'style': {'size': 13}, 'pad': 4},
              {'type': 'text', 'content': '• Firebase → Local → Defaults', 'style': {'size': 13}, 'pad': 4},
              {'type': 'text', 'content': '• S3 / CDN → SharedPrefs → Built-in', 'style': {'size': 13}, 'pad': 4},
            ],
          }},
          {'type': 'spacer'},
          {'type': 'button', 'content': 'Back', 'action': 'back', 'color': '#6366F1', 'pad': 16},
          const SizedBox(height: 32),
        ],
      },
    },
  });

  void _handleAction(String action) {
    if (action == 'back') Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final body = sduiMap('body');
    return Scaffold(
      appBar: AppBar(title: Text(sduiStr('title', 'SDUI Page'))),
      body: body.isEmpty
          ? const Center(child: CircularProgressIndicator())
          : Center(child: SduiParser(onAction: _handleAction).parse(body)),
    );
  }
}
