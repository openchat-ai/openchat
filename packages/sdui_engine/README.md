# SDUI Engine

Server-Driven UI for Flutter. Render widgets from JSON — no app store submission needed.

```dart
final parser = SduiParser(
  onAction: (action) => print('Tapped: $action'),
  vars: {'name': 'Alice'},
);

final widget = parser.parse({
  'type': 'column',
  'children': [
    {'type': 'text', 'content': 'Hello {{name}}', 'style': {'size': 24, 'bold': true}},
    {'type': 'button', 'content': 'Submit', 'action': 'submit', 'color': '#6366F1'},
  ],
});
```

## Why

Most UI changes require a full app rebuild and store review. SDUI lets you push UI updates as JSON — instant, no install, no review.

## Supported Widgets

| Type | Renders | Properties |
|------|---------|-----------|
| `column` / `row` | Flex layout | `center`, `children` |
| `text` | Label | `content`, `style.size/color/bold`, `pad`, `center` |
| `icon` | Material icon | `icon` (50+ names), `size`, `color`, `gradient`, `containerSize`, `radius` |
| `button` | Clickable | `icon`, `content`, `action`, `color`, `gradient`, `size`, `iconSize` |
| `card` | Elevated card | `child`, `gradient`, `bgColor`, `radius`, `borderColor`, `elevation`, `padding` |
| `image` | Network image | `url`, `width`, `height`, `fit` |
| `list` | Scrollable list | `children` |
| `list_tile` | List item | `title`, `subtitle`, `leadingIcon`, `trailingIcon`, `action` |
| `textfield` | Text input | `hint`, `value`, `action` |
| `checkbox` / `switch` | Toggle | `label`, `checked`, `action` |
| `spacer` / `divider` / `padding` | Layout helpers | — |
| `auto` | Lifecycle hook | `delay`, `action`, `onUnmount` |
| `for_each` | Dynamic list | `items`, `template` |
| `if:` | Conditional | `count > 5`, `name == 'Alice'` |
| `{{var}}` | Template variable | `{{username}}`, `{{count}}` |

## Quick Start

```yaml
dependencies:
  sdui_engine:
    git: https://github.com/openchat-ai/openchat.git
    path: packages/sdui_engine
```

```dart
import 'package:sdui_engine/sdui_engine.dart';

// One-shot parse
SduiParser(vars: data, onAction: handler).parse(json);

// Full page with auto-loading config
class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});
  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> with SduiPageState {
  @override
  String get sduiPage => 'dashboard';

  void _handleAction(String action) {
    // Your business logic here
  }

  @override
  Widget build(BuildContext context) {
    final body = sduiMap('body');
    if (body.isEmpty) return const Center(child: CircularProgressIndicator());
    return SduiParser(onAction: _handleAction).parse(body) ?? const SizedBox();
  }
}
```

## Config Sources

The engine doesn't care where your JSON comes from. You provide a config source at startup:

```dart
void main() {
  // Memory-only (prototyping)
  SduiPageState.defaultSource = SduiMemoryConfig({
    'dashboard': {'body': {'type': 'text', 'content': 'Hello'}},
  });

  // Cascade (production: network → cache → fallback)
  SduiPageState.defaultSource = SduiCascadeSource([
    MyApiSource(),          // fetch from your server
    MyCacheSource(),        // SharedPreferences
    SduiMemoryConfig(defaults),  // built-in fallback
  ]);

  runApp(MyApp());
}
```

Implement your own source in 5 lines:

```dart
class MyApiSource extends SduiConfigSource {
  @override
  Future<Map<String, dynamic>> load(String page) async {
    final res = await http.get(Uri.parse('https://api.example.com/sdui/$page'));
    if (res.statusCode == 200) return jsonDecode(res.body);
    return {}; // let cascade try the next source
  }
}
```

## Architecture

```
Your Server / CDN / S3
        ↓ JSON
SduiConfigSource.load(page)
        ↓ Map
SduiParser.parse(config)
        ↓ Widget tree
SduiPageState (mixin)
```

The engine handles rendering only. Business logic, state management, and data fetching stay in your Dart code.

## Learn More

- [Developer Guide](DEVELOPER.md) — engine internals, adding widget types
- [Example App](example/) — runnable demo with inline JSON + page mixin

## License

MIT
