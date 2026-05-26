# SDUI Engine Developer Guide

## How It Works

The engine is a JSON → Flutter Widget mapper in ~280 lines.

```
parse(Map node) → Widget?
  ├── check `if:` condition
  ├── dispatch by `type` (column/row/text/button/...)
  └── recursively parse children
```

## Adding A New Widget Type

1. Add the type name to the `switch` in `parse()`:

```dart
case 'chip':
  return Chip(label: Text(_v(node['label'])));
```

2. If it needs custom properties, add a helper method:

```dart
case 'chip': return _chip(node);
// ...
Widget _chip(Map m) => Chip(
  label: Text(_v(m['label'])),
  avatar: m['icon'] != null ? Icon(icons[m['icon']], size: 16) : null,
);
```

3. If it needs lifecycle, wrap in `_LifecycleWidget`:

```dart
case 'my_widget':
  return _LifecycleWidget(
    child: MyWidget(),
    onDispose: () => onAction?.call(m['onUnmount']),
  );
```

That's it. No registration, no plugin system, no code generation.

## Adding An Icon

```dart
// In SduiParser.icons map:
'my_icon': Icons.my_icon,

// Or at runtime:
SduiParser.registerIcons({'my_icon': Icons.my_icon});
```

## Helper Methods Reference

| Helper | Signature | Purpose |
|--------|-----------|---------|
| `_c(s)` | `String? → Color?` | Parse `#FF0000` hex color |
| `_n(m, k, [d])` | `Map, String, double → double` | Extract numeric prop |
| `_i(m, k, [d])` | `Map, String, int → int` | Extract integer prop |
| `_v(s)` | `String? → String` | Replace `{{var}}` from `_vars` |
| `_deco(m)` | `Map → BoxDecoration?` | Parse gradient/bgColor/radius/border |
| `_style(s)` | `dynamic → TextStyle?` | Parse `{size, color, bold}` |
| `_edge(p)` | `dynamic → EdgeInsetsGeometry` | Parse padding (num or `{l,t,r,b}`) |
| `_eval(c)` | `String → bool` | Evaluate `count > 5` condition |
| `_children(list)` | `dynamic → List<Widget>` | Parse children array, handle `flex` |

## Config Sources

```
SduiConfigSource (abstract)
  ├── SduiMemoryConfig     — in-memory map
  ├── SduiConfigEmpty      — always returns {}
  └── SduiCascadeSource    — try each source in order
      └── Your custom source
```

To create a custom source:

```dart
class MySource extends SduiConfigSource {
  @override
  Future<Map<String, dynamic>> load(String page) async {
    // Try network
    // Fallback to cache
    // Fallback to defaults
  }
}
```

## File Structure

```
lib/src/
├── sdui_parser.dart    # Core engine (~280 lines). Zero deps.
├── sdui_config.dart    # Config source interfaces + implementations
├── sdui_page.dart      # SduiPageState mixin
└── sdui_style.dart     # Global style tokens
```

Total: ~350 lines of engine code.

## Design Principles

1. **No runtime — no code generation — no plugins.**
   Just a class you instantiate and call `.parse()` on.

2. **Rendering only.**
   State management, data fetching, HTTP, routing → your app's job.

3. **JSON drives what, Dart drives how.**
   JSON says "show a button". Dart says "when tapped, call this API".

4. **Config source is pluggable.**
   The engine doesn't care where config comes from. Memory, file, network, S3 — your choice.

5. **~350 lines is a feature, not a limitation.**
   Every line is necessary. No dead code, no generated code, no magic.
