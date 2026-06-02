# spec: SDUI Engine

> JSON-to-Flutter 渲染引擎：parse(SDUI JSON) → build(Widget tree)。
> 5 个本地文件，核心解析在 `sdui_engine` 外部包中。

## 数据流

```
SduiPageState.loadSduiLayout()
  → SduiQiniuSource.load(page)
    → 1. Individual file: oc/config/ui_{page}.json
    → 2. Merged ui_app.json[page]
    → 3. SharedPreferences cache
    → 4. Compile-time defaults
  → SduiParser.parse(layout) → Widget tree

SduiActions.handle(context, action)
  → 内置 actions: refresh / demo / navigate: / snackbar: / dialog: / sdui_dialog: / http(s): / tel: / mailto:
  → 自定义 actions: 透传 callback

SduiFragmentWidget
  → fetchConfigFile(path) → SduiParser → Widget
```

## 接口签名

```dart
// sdui_config.dart — 实际代码
class SduiQiniuSource extends SduiConfigSource {
  static const _maxDepth = 8;
  static const _maxChildren = 50;
  static const _allowedTypes = { 'column', 'row', 'list', 'text', 'button', 'spacer', 'icon', 'list_tile', 'padding', 'divider', 'image', 'card', 'sdui_fragment', 'auto', 'checkbox', 'switch', 'textfield', 'users_list', 's3_data', 'for_each' };
  static const Map<String, Map<String, dynamic>> defaults;
  const SduiQiniuSource();
  static bool isValid(dynamic node, [int depth = 0]);
  @override
  Future<Map<String, dynamic>> load(String page);
  static Future<void> clearCache();
}
const sduiSource = SduiQiniuSource();

// sdui_actions.dart — 实际代码
class SduiActions {
  static void handle(BuildContext context, String action, {VoidCallback? onRefresh, VoidCallback? onDemo, Map<String, VoidCallback>? custom});
}

// sdui_style.dart — 实际代码
class SduiStyle {
  static double sp(String key, [double d = 12]);
  static double rd(String key, [double d = 12]);
  static Widget sectionHeader(String text, AppTheme theme);
  static Widget bodyText(String text, AppTheme theme, {double size = 13});
  static Widget caption(String text, AppTheme theme, {double size = 11});
  static Container sectionContainer(Widget child, AppTheme theme);
  static EdgeInsets sectionPadding;
  static double vGap(String key, [double d = 12]);
}

// sdui_fragment.dart — 实际代码
class SduiFragmentWidget extends StatefulWidget {
  final String path;
  final void Function(String action)? onAction;
  const SduiFragmentWidget({required this.path, this.onAction, super.key});
}

// sdui.dart — barrel
export 'sdui_config.dart';
export 'sdui_actions.dart';
export 'sdui_style.dart';
export 'sdui_fragment.dart';
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| JSON 格式错误 / 字段缺失 | SduiQiniuSource.load() 返回 defaults[page] |
| SDUI node type 不在白名单 | isValid() 返回 false → 使用默认值 |
| node 嵌套深度 > 8 | isValid() 返回 false |
| children 数量 > 50 | isValid() 返回 false |
| string 字段长度 > 500 | isValid() 返回 false |
| 字符串字段含超长内容 | isValid() 返回 false |
| cache 命中但 JSON 解析失败 | 忽略缓存，继续用 defaults |
| 桥接不可达 | fetchConfigFile() 多次重试后返回 cache 或 null |
| navigate: 路径不存在 | Navigator.pushNamed() 静默 (不报错) |
| 自定义 action 未注册 | 静默 no-op |
| tel:/mailto:/http(s): URL | 复制到剪贴板并显示 snackbar |

## 文件清单

| 文件 | 职责 | 行数上限 | 实际行数 |
|------|------|---------|---------|
| `sdui.dart` | barrel export | 10 | 3 |
| `sdui_config.dart` | 配置加载 + 校验 + defaults | 120 | 110 |
| `sdui_actions.dart` | 内置 action 处理 | 80 | 66 |
| `sdui_style.dart` | 样式辅助 (sp/rd/sectionHeader) | 60 | 39 |
| `sdui_fragment.dart` | Fragment Widget 包装 | 60 | 41 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C18 | `[C18] sdui load` | sdui_config.dart:load | `C18 sdui load page=X` |
| C19 | `[C19] sdui action` | sdui_actions.dart:handle | `C19 sdui action=X` |

## 不变量 (invariants)

```
// === invariants ===
// - SduiQiniuSource 是单例 (const sduiSource)
// - isValid() 限制 node 嵌套深度和子节点数 (DoS 防护)
// - fetchConfigFile() 优先 individual file → merged ui_app → cache → defaults
// - QiniuDirectClient.fetchConfigFile 内部已重试 2 次
// - SduiParser 来自外部包 sdui_engine
// - SduiActions.handle 不抛异常 (所有 action 静默失败)
// - SduiStyle 的 sp/rd 委托给 QiniuDirectClient 静态方法
```
