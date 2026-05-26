# SDUI Engine — Developer Guide

## How It Works

The engine is a JSON → Flutter Widget mapper in ~280 lines.

```
parse(Map node) → Widget?
  ├── evaluate `if:` condition
  ├── dispatch by `type` (column/row/text/button/...)
  └── recurse into children
```

## Adding A New Widget Type

**Step 1.** Add a case to the `switch` in `parse()`:

```dart
case 'chip':
  return Chip(label: Text(_v(node['label'])));
```

**Step 2.** If the widget needs custom layout, extract to a helper:

```dart
case 'chip': return _chip(node);

Widget _chip(Map m) => Chip(
  label: Text(_v(m['label'])),
  avatar: m['icon'] != null ? Icon(icons[m['icon']], size: 16) : null,
);
```

**Step 3.** If it needs dispose callbacks, wrap in `_LifecycleWidget`:

```dart
case 'player':
  return _LifecycleWidget(
    child: AudioPlayerWidget(url: _v(m['url'])),
    onDispose: () => onAction?.call(m['onUnmount']),
  );
```

No registration, no plugin system, no code generation — just add a switch case.

## Adding An Icon

```dart
// Statically (in the icons map):
'telegram': Icons.telegram,

// Or at runtime:
SduiParser.registerIcons({'telegram': Icons.telegram});
```

## Helper API

| Helper | Signature | Purpose |
|--------|-----------|---------|
| `_c(s)` | `String? → Color?` | Parse `#FF0000` |
| `_n(m, k, [d])` | `(Map, String, double) → double` | Numeric prop |
| `_i(m, k, [d])` | `(Map, String, int) → int` | Integer prop |
| `_v(s)` | `String? → String` | `{{var}}` substitution |
| `_deco(m)` | `Map → BoxDecoration?` | Gradient / bgColor / radius / border |
| `_style(s)` | `dynamic → TextStyle?` | Parse `{size, color, bold}` |
| `_edge(p)` | `dynamic → EdgeInsetsGeometry` | Parse padding |
| `_eval(c)` | `String → bool` | Parse `count > 5` |
| `_children(list)` | `dynamic → List<Widget>` | Parse children with flex |

## Config Sources

```
SduiConfigSource (abstract)
  ├── SduiMemoryConfig       — in-memory map
  ├── SduiConfigEmpty        — always returns {}
  └── SduiCascadeSource      — try each in order
      └── Your custom source
```

Custom source example:

```dart
class FirebaseSource extends SduiConfigSource {
  @override
  Future<Map<String, dynamic>> load(String page) async {
    final doc = await FirebaseFirestore.instance.collection('sdui').doc(page).get();
    if (doc.exists) return Map<String, dynamic>.from(doc.data()!);
    return {};
  }
}
```

## Code Layout

```
lib/src/
├── sdui_parser.dart    # Core engine (~280 lines). Zero dependencies.
├── sdui_config.dart    # Config source interface + 3 implementations
├── sdui_page.dart      # SduiPageState mixin
└── sdui_style.dart     # Global style tokens
```

~350 lines total.

## Design Rules

1. **Zero dependencies.** Not even `http`, `shared_preferences`, or `provider`. If you need external packages, keep them in the app layer.
2. **No code generation.** No build_runner, no freezed, no annotations.
3. **Every prop needs a default.** Use `_n(m, 'key', fallback)` — never assume a value exists.
4. **Engine < 400 lines.** Every addition should replace or inline existing code.
5. **JSON decides what. Dart decides how.** The config specifies layout and content; the app handles behavior.
