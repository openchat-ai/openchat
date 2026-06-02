# spec: ResponsiveLayout

> 响应式布局基础组件库：断点检测 + 自适应 Builder/Grid/Split/Sheet + 容器工具

## 数据流

```
MediaQuery.size.width
  → getDeviceType (mobile/tablet/desktop)
    → ResponsiveBuilder → 选 mobile/tablet/desktop Widget
    → AdaptiveGrid → 选列数 2/3/4
    → SplitLayout → mobile 仅 master, 平板/桌面 Row(master | detail)
    → AdaptiveSheet.show → mobile modal bottom sheet, 平板/桌面 dialog
```

## 接口签名

```dart
class Breakpoints {
  static const double mobile = 375;
  static const double mobileLg = 414;
  static const double tablet = 768;
  static const double desktop = 1024;
}

enum DeviceType { mobile, tablet, desktop }

DeviceType getDeviceType(BuildContext context);

class ResponsiveBuilder extends StatelessWidget {
  final Widget mobile;
  final Widget? tablet;
  final Widget? desktop;
}

class AdaptiveGrid extends StatelessWidget {
  final List<Widget> children;
  final double spacing;
  final double runSpacing;
  final EdgeInsets padding;
}

class SplitLayout extends StatelessWidget {
  final Widget master;
  final Widget? detail;
  final double masterWidth;
  final bool showDetail;
}

class AdaptiveSheet extends StatelessWidget {
  final Widget child;
  final double? height;
  final bool isDismissible;
  static Future<T?> show<T>({...});  // 移动=bottomSheet, 桌面=dialog
}

class SafeAreaWrapper extends StatelessWidget {
  final Widget child;
  final bool top, bottom, left, right;
  final EdgeInsets margin;
}

class ConstrainedContainer extends StatelessWidget {
  final Widget child;
  final double maxWidth;
  final Alignment alignment;
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| width < mobile | 走 mobile 分支 |
| width 在 tablet 与 desktop 之间 | 走 tablet 分支 |
| ResponsiveBuilder 未传 tablet | 走 mobile（fallback） |
| ResponsiveBuilder 未传 desktop | 走 tablet 或 mobile（fallback） |
| AdaptiveSheet.show height 未传 | mobile: 屏幕高 70%, 桌面: 600 |
| SplitLayout mobile 模式 | 只显示 master，不显示 detail |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `breakpoints.dart` | 断点常量 + 设备类型枚举 + getDeviceType | 40 |
| `responsive_builder.dart` | ResponsiveBuilder | 50 |
| `adaptive_grid.dart` | AdaptiveGrid | 60 |
| `split_layout.dart` | SplitLayout | 50 |
| `adaptive_sheet.dart` | AdaptiveSheet | 80 |
| `safe_area_wrapper.dart` | SafeAreaWrapper | 50 |
| `constrained_container.dart` | ConstrainedContainer | 40 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| - | - | - | 纯 UI 组件，无日志点 |

## 不变量（invariants）

```
// === invariants ===
// - getDeviceType 内部只读 MediaQuery，不修改状态
// - AdaptiveSheet.show 必须是 async，返回 Future<T?>（showModalBottomSheet/showDialog 契约）
// - 所有 wrapper 透传构造参数，不做隐式变换
```
