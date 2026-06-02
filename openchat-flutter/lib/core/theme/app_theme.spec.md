# spec: AppTheme

> 5 套主题预设（Glassmorphism/Minimal Zen/Nature Organic/Retro Wave/Corporate Pro），统一色彩、圆角、阴影、特效字段

## 数据流

```
AppTheme.all / glassmorphism / minimalZen / ...
  → AppTheme(style, name, description, background, surface, primary, ...)
    → UI 直接读取: theme.background, theme.gradientPrimary, theme.useGlow ...
```

## 接口签名

```dart
enum ThemeStyle { glassmorphism, minimalZen, natureOrganic, retroWave, corporatePro }

class AppTheme {
  final ThemeStyle style;
  final String name;
  final String description;
  // 核心色彩
  final Color background, surface, primary, secondary, accent;
  final Color textPrimary, textSecondary, textTertiary;
  // 状态色
  final Color success, warning, error, info;
  // 渐变
  final List<Color> gradientPrimary, gradientAccent;
  // 圆角
  final double radiusSmall, radiusMedium, radiusLarge;
  // 阴影/特效
  final List<BoxShadow> shadows;
  final bool useGlassmorphism, useGlow, useNeon;
  final double? glassOpacity, blurAmount;

  static final glassmorphism, minimalZen, natureOrganic, retroWave, corporatePro;
  static List<AppTheme> get all;
}
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| theme 引用未设置字段 | 编译时强制 (required 字段) |
| 预设未提供某字段 | 使用类默认值 (radiusSmall=8, radiusMedium=16, radiusLarge=24) |
| useGlow=true 但 shadows 为空 | 阴影为 []，UI 自行用 BoxShadow |
| glassOpacity/blurAmount 未提供 | 字段为 null，UI 走 fallback |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `app_theme.dart` | AppTheme 类定义 + 字段 + all getter | 100 |
| `theme_presets.dart` | 5 个 static final 预设实例 | 200 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| - | - | - | 纯数据类，无日志 |

## 不变量（invariants）

```
// === invariants ===
// - AppTheme 不可变 (final 字段)
// - 5 个 static final 实例全局共享，不重新构造
// - 字段命名严格一致 (textPrimary 等)，UI 直接引用
```
