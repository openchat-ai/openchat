# SDUI Engine

A server-driven UI engine for Flutter. Render UI from JSON — no compile needed.

```dart
final parser = SduiParser(
  onAction: (action) => print('Button tapped: $action'),
  vars: {'name': 'Alice'},
);

final widget = parser.parse({
  'type': 'column',
  'children': [
    {'type': 'text', 'content': 'Hello {{name}}', 'style': {'size': 24}},
    {'type': 'button', 'content': 'Click', 'action': 'hello'},
  ],
});
```

## Features

- 20 UI types: column, row, text, button, icon, card, image, list, list_tile, textfield, checkbox, switch, spacer, divider, padding, auto, for_each, sdui_fragment, s3_data, auto
- Conditional rendering (`if:`)
- Template variables (`{{var}}`)
- Data list iteration (`for_each`)
- Lifecycle hooks (`onUnmount`)
- Gradient backgrounds, border radius, border colors
- 40+ built-in icons, extensible
- Global style tokens (spacing / radius / section headers)

## Quick Start

```yaml
dependencies:
  sdui_engine:
    git: https://github.com/your/sdui_engine.git
```

```dart
import 'package:sdui_engine/sdui_engine.dart';

// Optional: global style tokens
SduiStyle.init({
  'spacing': {'xs': 4, 'sm': 8, 'md': 12, 'lg': 16, 'xl': 24},
  'radius': {'sm': 8, 'md': 12, 'lg': 16, 'xl': 20},
});

// Parse JSON into Flutter widgets
final widget = SduiParser(
  onAction: yourActionHandler,
  vars: yourData,
).parse(yourJson);
```

## Page Mixin

For stateful pages, use the `SduiPageState` mixin:

```dart
class _MyPageState extends State<MyPage> with SduiPageState {
  @override String get sduiPage => 'my_page';
  @override SduiConfigSource get configSource => yourConfigSource;

  void _handleAction(String action) {
    // handle button taps
  }

  @override
  Widget build(BuildContext context) {
    return SduiParser(onAction: _handleAction, vars: {}).parse(sduiLayout['body']);
  }
}
```

## Architecture

```
JSON Config → SduiParser.parse() → Flutter Widget Tree
                  ↓
         onAction callback → Your Business Logic
                  ↓
         {{var}} substitution → Your Data Layer
```

The engine handles rendering only. State management, data fetching, and business logic stay in Dart.
