# spec: SDUI Engine

> JSON-to-Flutter 渲染引擎：parse(SDUI JSON) → build(Widget tree)。
> 5 文件按职责拆分，`sdui_config.dart` (108 行) 接近上限。

## 数据流

```
JSON fragment → parse(layout, style, vars) → build → Widget
  → 基础组件: text, icon, image, button
  → 布局组件: column, row, stack, padding, sizedbox
  → 控制组件: conditional, loop, fragment(ref)
  → 表达式: vars 引用 + 简单运算 (+ - * / ?:)
```

## 接口签名

```dart
class SduiParser {
  SduiParser({Map<String, dynamic>? vars, Function? onAction});
  Widget? parse(Map<String, dynamic> json);
  static Map<String, IconData> get icons;
  static void registerFragment(String name, Map<String, dynamic> json);
  static Map<String, dynamic>? getFragment(String name);
}

mixin SduiPageState on State {
  String get sduiPage;
  Map<String, dynamic> get sduiLayout;
  Future<void> loadSduiLayout();
  void reloadSduiLayout();
}

class SduiConfig {
  static Future<Map<String, dynamic>> load(String pageName);
  static Future<Map<String, dynamic>?> fetchRemote(String key);
}

typedef SduiActionHandler = void Function(String action, Map<String, dynamic> args);
class SduiActions {
  static void register(String name, SduiActionHandler handler);
  static void execute(String name, Map<String, dynamic> args, BuildContext context);
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| JSON 格式错误 | parse() 返回 null，不 crash |
| vars 引用不存在 key | 表达式求值为 null → 显示空 (text="") |
| fragment 循环引用 | 递归深度 >5 → 抛出异常防止死循环 |
| icon 名称无效 | 使用 Icons.help (fallback) |
| style 引用了不存在的 class | 忽略该 class，只应用基础 style |
| button.action 未注册 | 点击无声 (no-op) |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `sdui.dart` | barrel export | 10 |
| `sdui_parser.dart` | JSON → Widget 核心解析 | 200 |
| `sdui_config.dart` | 配置加载 + 缓存 | 120 |
| `sdui_actions.dart` | Action 注册 + 执行 | 80 |
| `sdui_style.dart` | 样式解析 (class maps) | 60 |
| `sdui_fragment.dart` | Fragment 注册 + 引用 | 60 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C18 | `[C18] sdui parse` | sdui_parser.dart | `C18 parse type=X id=Y` |
| C19 | `[C19] sdui action` | sdui_actions.dart | `C19 action=X args=Y` |

## 不变量 (invariants)

```
// === invariants ===
// - 所有表达式求值用 _evalValue，不直接 eval() (安全)
// - fragment 注册是全局静态映射 (应用生命周期)
// - style 解析优先级: inline > class > default
// - vars 传入后不可修改 (immutable snapshot)
// - parse 失败只能返回 null，不能抛出 Widget error
```
