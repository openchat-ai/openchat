import 'package:flutter/material.dart';
import 'package:sdui_engine/sdui_engine.dart';

void main() {
  SduiStyle.init({
    'spacing': {'xs': 4, 'sm': 8, 'md': 12, 'lg': 16, 'xl': 24},
    'radius': {'sm': 8, 'md': 12, 'lg': 16, 'xl': 20},
    'sectionHeaderSize': 16,
  });
  runApp(const _App());
}

class _App extends StatelessWidget {
  const _App();
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'SDUI Demo',
    theme: ThemeData.dark(),
    initialRoute: '/',
    routes: {
      '/': (context) => const _DemoPage(),
      '/page': (context) => const _SduiPageDemo(),
    },
  );
}

// ─── Inline JSON demo ────────────────────────────────────

class _DemoPage extends StatefulWidget {
  const _DemoPage();
  @override
  State<_DemoPage> createState() => _DemoPageState();
}

class _DemoPageState extends State<_DemoPage> {
  int _count = 0;
  final _items = [
    {'name': 'Alice', 'role': 'Engineer'},
    {'name': 'Bob', 'role': 'Designer'},
    {'name': 'Charlie', 'role': 'PM'},
  ];

  @override
  Widget build(BuildContext context) {
    final layout = {
      'type': 'column',
      'center': true,
      'children': [
        {'type': 'text', 'content': 'SDUI Demo', 'style': {'size': 24, 'bold': true}, 'pad': 16},
        {'type': 'icon', 'icon': 'code', 'size': 64, 'color': '#7C4DFF'},
        {'type': 'text', 'content': 'Clicked $_count times', 'pad': 8, 'style': {'size': 14}},
        {'type': 'button', 'content': 'Tap me', 'action': 'increment', 'color': '#7C4DFF'},
        {'type': 'divider'},
        {'type': 'text', 'content': 'For Each Demo →', 'pad': 16, 'style': {'size': 16, 'bold': true}},
        {'type': 'for_each', 'items': 'people', 'template': {
          'type': 'card', 'padding': 12, 'margin': 4, 'child': {
            'type': 'row', 'children': [
              {'type': 'icon', 'icon': 'person', 'size': 24, 'color': '#448AFF'},
              {'type': 'text', 'content': '  {{name}} — {{role}}', 'flex': 1},
            ],
          },
        }},
        {'type': 'button', 'content': 'Open SduiPage Demo →', 'action': 'navigate_page', 'pad': 16},
      ],
    };

    final parser = SduiParser(
      onAction: (a) {
        if (a == 'increment') setState(() => _count++);
        if (a == 'navigate_page') Navigator.pushNamed(context, '/page');
      },
      vars: {'people': _items, 'count': _count},
    );

    return Scaffold(
      appBar: AppBar(title: const Text('SDUI Engine Demo')),
      body: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(16), child: parser.parse(layout))),
    );
  }
}

// ─── SduiPageState + SduiMemoryConfig demo ──────────────

class _SduiPageDemo extends StatefulWidget {
  const _SduiPageDemo();
  @override
  State<_SduiPageDemo> createState() => _SduiPageDemoState();
}

class _SduiPageDemoState extends State<_SduiPageDemo> with SduiPageState {
  @override String get sduiPage => 'demo';

  @override
  SduiConfigSource get configSource => SduiMemoryConfig({
    'demo': {
      'title': 'Page Demo',
      'body': {
        'type': 'column', 'center': true, 'children': [
          {'type': 'icon', 'icon': 'check_circle', 'size': 64, 'color': '#4CAF50'},
          {'type': 'text', 'content': 'Config loaded!', 'style': {'size': 20}, 'pad': 16},
          {'type': 'text', 'content': 'This page uses SduiPageState + SduiMemoryConfig', 'style': {'size': 13, 'color': '#9E9E9E'}, 'pad': 8},
          {'type': 'button', 'content': 'Back', 'action': 'back', 'color': '#7C4DFF', 'pad': 16},
        ],
      },
    },
  });

  void _handleAction(String a) {
    if (a == 'back') Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final body = sduiMap('body');
    if (body.isEmpty) return const Scaffold(body: Center(child: Text('Loading...')));
    return Scaffold(
      appBar: AppBar(title: Text(sduiStr('title', 'SDUI Page'))),
      body: Center(child: SduiParser(onAction: _handleAction).parse(body)),
    );
  }
}
