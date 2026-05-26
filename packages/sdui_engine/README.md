# SDUI Engine

Ship Flutter UI changes **without app store review**.

```dart
SduiParser(vars: data, onAction: handler).parse(json);
```

SDUI Engine renders Flutter widgets from JSON at runtime. Push a JSON file to your server, CDN, or S3 — every user sees the new UI instantly. No rebuild. No review. No install.

## Why

| Without SDUI | With SDUI |
|-------------|-----------|
| Fix a typo → rebuild → submit → wait 1-3 days | Fix JSON → upload → instant |
| Change button color → same process | Change hex value → instant |
| A/B test a layout → two APKs | Two JSON files → same APK |
| Fix a crash in UI code → full release | Fix JSON → ship in 5 seconds |

## How It Works

```json
{
  "type": "column",
  "children": [
    {"type": "text", "content": "Hello {{name}}", "style": {"size": 24, "bold": true}},
    {"type": "button", "content": "Submit", "action": "submit", "color": "#6366F1"}
  ]
}
```

```dart
// Your Flutter app — 2 lines
final widget = SduiParser(
  onAction: (action) => handleSubmit(),
  vars: {'name': user.name},
).parse(layout);
```

## Features

| Category | Widgets |
|----------|---------|
| Layout | `column`, `row`, `list`, `spacer`, `divider`, `padding` |
| Content | `text`, `icon` (50+), `image`, `card` |
| Input | `button`, `textfield`, `checkbox`, `switch`, `list_tile` |
| Data | `for_each` (dynamic list iteration) |
| Control | `if:` conditions, `{{var}}` templates, `auto` lifecycle hooks |
| Style | hex colors, **gradients**, border radius, shadows |

## Quick Start

```yaml
dependencies:
  sdui_engine: ^1.0.0
```

```dart
import 'package:sdui_engine/sdui_engine.dart';

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});
  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> with SduiPageState {
  @override
  String get sduiPage => 'dashboard';

  void _handleAction(String action) {
    // Your business logic. JSON drives UI, Dart drives behavior.
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

```dart
void main() {
  // Memory (prototyping)
  SduiPageState.defaultSource = SduiMemoryConfig({
    'dashboard': {'body': {'type': 'text', 'content': 'Hello'}},
  });

  // Cascade (production)
  SduiPageState.defaultSource = SduiCascadeSource([
    ApiSource(),          // your backend
    CacheSource(),        // SharedPreferences
    SduiMemoryConfig(defaults),  // never blank
  ]);

  runApp(MyApp());
}
```

## Size

**350 lines** of engine code. Zero dependencies besides Flutter itself.

## Architecture

```
JSON → SduiParser.parse() → Widget tree
           ↓
    onAction callback → your Dart code
           ↓
    {{var}} substitution → your data layer
```

The engine renders. State, data, and business logic stay in Dart.

## Documentation

- [Developer Guide](DEVELOPER.md) — internals, adding widget types
- [Example App](example/) — runnable demo

## License

MIT

---

*SDUI Engine was extracted from [OpenChat](https://github.com/openchat-ai/openchat), a P2P voice app where every UI element is remote-configurable. 30 rounds of iteration, 11 pages, zero compile.*
