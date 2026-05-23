# OpenChat UI 设计系统

> **最后更新**: 2026-04-29

## 概述

OpenChat UI 设计系统是一个完整的、可复用的组件库，支持 5 种主题变体和响应式布局。

## 核心特性

- 🎨 **5 种主题变体**: 玻璃拟态、极简禅意、自然有机、复古蒸汽波、商务专业
- 📱 **响应式布局**: 支持移动端、平板和桌面端
- ♿ **无障碍支持**: 符合 WCAG 2.1 标准
- 🎯 **流畅动画**: 一致的 150-300ms 动画时长

## 主题系统

### 主题变体

| 主题名称 | 风格 | 适用场景 |
|----------|------|----------|
| Glassmorphism | 赛博霓虹，毛玻璃效果 | 默认深色主题 |
| Minimal Zen | 极简禅意，高留白 | 专注模式 |
| Nature Organic | 自然有机，大地色系 | 放松场景 |
| Retro Wave | 复古蒸汽波，高饱和 | 创意场景 |
| Corporate Pro | 商务专业，高对比 | 专业场景 |

### 主题模式

- **自动**: 跟随系统
- **浅色**: 强制浅色
- **深色**: 主题深色  - **手动**: 用户选择具体主题

## 布局系统

### 断点系统

```dart
class Breakpoints {
  static const double mobile = 375;
  static  static const double mobileLg = 414;
  static const double tablet = 768;
  static const double desktop = 1024;
}
```

### 8pt 网格

| Token | 值 |
|-------|-----|
| space-1 | 8 |
| space-2 | 16 |
| space-3 | 24 |
| space-4 | 32 |
| space-5 | 48 |
| space-6 | 64 |

### 响应式组件

#### ResponsiveBuilder
```dart
ResponsiveBuilder(
  mobile: MobileLayout(),
  tablet: TabletLayout(),
  desktop: DesktopLayout(),
)
```

#### SplitLayout
```dart
SplitLayout(
  master: MasterPane(),
  detail: DetailPane(),
  showDetail: selectedItem != null,
)
```

## 组件库

### 卡片组件 (AppCard)

5 种变体：
- `CardVariant.filled` - 填充型
- `CardVariant.outlined` - 边框型
- `CardVariant.elevated` - 浮起型
- `CardVariant.gradient` - 渐变型
- `CardVariant.glass` - 毛玻璃

```dart
AppCard(
  variant: CardVariant.gradient,
  onTap: () => handleTap(),
  child: ContentWidget(),
)
```

### 列表项 (ListCard)

```dart
ListCard(
  leading: Icon(Icons.settings),
  leadingColor: theme.primary,
  title: '设置',
  subtitle: '应用设置',
  trailing: Icon(Icons.chevron_right),
  onTap: () => navigate(),
  showDivider: true,
)
```

### 统计卡片 (StatCard)

```dart
StatCard(
  label: '运行中',
  value: '12',
  icon: Icons.play_circle_outline,
  color: theme.success,
  onTap: () => viewDetails(),
)
```
  : 10/14
  : 12
  
### 图片卡片 (ImageCard)

```dart
ImageCard(
  imageUrl: 'https://example.com/image.jpg',
  title: '卡片标题',
  subtitle: '描述文字',
  aspectRatio: 16 / 9,
  onTap: () {},
)
```

### 操作卡片 (ActionCard)

```  dart
ActionCard(
  icon: Icons.add,
  label: '添加',
  onTap: () {},
  color: theme.primary,
)
```

## 列表组件

### 分组列表

```dart
GroupedList<String>(
  items: items,
  groupBy: (item) => item.category,
  itemBuilder: (item) => ListCard(...),
  groupHeaderBuilder: (group) => SectionHeader(...),
)
```

### 可展开列表项

```dart
ExpandableListItem(
  header: Text('标题'),
  content: DetailedContent(),
  initiallyExpanded: false,
)
```
、
### 时间线列表

```dart
TimelineList<Event>(
  items: events,
  itemBuilder: (item, index) => EventCard(item),
  isReversed: false,
)
```

### 加载更多

```dart
LoadMoreList(
  items: itemWidgets,
  onLoadMore: () => loadMore(),
  hasMore: hasMoreData,
)
```

## 响应式模式

### 移动端优先

所有组件默认优化移动端，通过 ResponsiveBuilder 扩展到其他设备。

### 平板适配

使用 SplitLayout 实现主从布局（类似邮件应用）。

### 桌面适配

使用 ConstrainedContainer 限制最大宽度，保持内容可读性。

### 底部 Sheet

移动端：底部滑出
平板/桌面：居中对话框

```dart
AdaptiveSheet.show(
  context: context,
  builder: (context) => Content(),
  height: 600,
)
```

## 动画规范

| 类型 | 时长 | 缓动 |
|------|------|------|
| 快速反馈 | 100-150ms | easeOut
| 标准过渡 | 200-300ms | easeInOut
| 复杂动画 | 300-500ms | easeInOut
| 微交互 | 150ms | easeOut

### 常用动画

```dart
// 缩放
AnimatedScale(
  scale: isPressed ? 0.95 : 1.0,
  duration: Duration(milliseconds: 150),
  child: MyWidget(),
)

// 容器
AnimatedContainer(
  duration: Duration(milliseconds: 200),
  decoration: BoxDecoration(...),
  child: MyWidget(),
)
```
## 使用示例

### 主页布局

```dart
CustomScrollView(
  slivers: [
    _buildHeader(),
    _buildCategoryChips(),
    SliverPadding(
      padding: EdgeInsets.all(16),
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) => ListCard(...),
          childCount: 10,
        ),
      ),
    ),
  ],
)
```

### Agent 中心

```dart
Row(
  children: [
    Expanded(child: StatCard(label: '运行中', value: '12', icon: Icons.play_circle, color: theme.success)),
    Expanded(child: StatCard(label: '待处理', value: '5', icon: Icons.pending, color: color: theme.warning)),
    Expanded(child: StatStyle.textPrimary,
  fontSize: 15,
  fontWeight: FontWeight.w500,
);

final bodyStyle = TextStyle(
  color: theme.textSecondary,
  fontSize: 13,
);

final captionStyle = TextStyle(
  color: theme.textTertiary,
  font  Size: 11,
);
```

## 文件结构

```
lib/
  core/
    theme/
      app_theme.dart          # 主题定义
  providers/
    theme_provider.dart       # 主题状态管理
  ui/
    components/
      layout/
        responsive_layout.dart  # 响应式布局
      cards/
        app_cards.dart        # 卡片组件
      lists/
        app_lists.dart        # 列表组件
    screens/
      home_screen.dart        # 首页
      agent_hub_screen.dart   # Agent 中心
      settings_screen.dart    # 设置页
      ...
```

## 最佳实践
```  1. Always use `ref.watch(currentThemeProvider)` for theme updates
2. Use ConsumerWidget for screens
3. Use ConsumerWidget for components
4. Keep components small and reusable
5. Use 8pt spacing scale
6. Animate 所有交互反馈
7. 在 Settings 中提供主题切换

## 更新日志

- v1.0 - Initial design system with 5 themes
- v1.1 - Added responsive layout components
- v1.2 - Added card and list components
- v1.3 - Integrated components into all screens