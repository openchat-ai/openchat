# SDUI Engine

A server-driven UI engine for Flutter. Render UI from JSON — no compile needed.

```dart
final widget = SduiParser(
  onAction: (a) => print('Tapped: $a'),
  vars: {'name': 'Alice'},
).parse({
  'type': 'column',
  'children': [
    {'type': 'text', 'content': 'Hello {{name}}', 'style': {'size': 24}},
    {'type': 'button', 'content': 'Click', 'action': 'hello', 'color': '#7C4DFF'},
  ],
});
```

## Features

| 类型 | 用途 |
|------|------|
| `column` `row` | 布局容器 |
| `text` `icon` `button` `image` | 基础元素 |
| `card` `list_tile` `divider` `spacer` | 复合组件 |
| `textfield` `checkbox` `switch` | 表单控件 |
| `list` | 静态列表 |
| `padding` | 内边距 |
| `auto` | 生命周期（onMount / onUnmount） |
| `for_each` | 数据列表迭代 |
| `if:` | 条件渲染（`==` `!=` `>` `<` `>=` `<=`）|
| `{{var}}` | 模板变量 |
| `gradient` | 渐变背景（任意元素） |
| 图标 | 50+ 内置，可扩展 |

## Quick Start

```yaml
dependencies:
  sdui_engine:
    git: https://github.com/your/sdui_engine.git
```

```dart
import 'package:sdui_engine/sdui_engine.dart';

// 1. 解析 JSON
SduiParser(onAction: myHandler).parse(jsonMap);

// 2. 完整页面
class _MyPage extends State<MyPage> with SduiPageState {
  @override String get sduiPage => 'my_page';

  @override
  Widget build(BuildContext context) {
    return SduiParser(onAction: _handle).parse(sduiLayout['body']);
  }
}
```

## Config Sources

```dart
// 内存配置（测试/快速原型）
SduiPageState.defaultSource = SduiMemoryConfig({'my_page': {...}});

// 级联配置（生产：网络 → 缓存 → 默认）
SduiPageState.defaultSource = SduiCascadeSource([
  myNetworkSource,      // 你的后端
  myCacheSource,        // SharedPreferences
  SduiMemoryConfig(fallbackDefaults),  // 永远不崩
]);

// 自定义
class MySource extends SduiConfigSource {
  @override Future<Map<String, dynamic>> load(String page) async {
    final json = await http.get('.../config/$page.json');
    return jsonDecode(json.body);
  }
}
```

## Architecture

```
JSON Config → SduiParser → Widget Tree
                  ↓
         onAction → Your Logic
                  ↓
         {{var}} → Your Data
```

Only rendering. State, data, logic stay in Dart.

## Demo

See `example/` for a runnable Flutter app with inline JSON + SduiPageState.
