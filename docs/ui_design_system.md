# OpenChat UI 设计系统

> **最后更新**: 2026-04-29

## 一、信息架构 (Information Architecture)

### 核心功能矩阵
```
┌─────────────────────────────────────────────────────────┐
│  一级功能    │  二级功能        │  三级功能              │
├─────────────────────────────────────────────────────────┤
│             │  ├─ 单聊          │  文字/图片/文件/语音    │
│  消息        │  ├─ 群聊          │  群组管理/群公告        │
│  (首页)      │  ├─ AI对话        │  代码助手/创作助手      │
│             │  └─ 通知中心      │  @提及/系统通知        │
├─────────────────────────────────────────────────────────┤
│             │  ├─ 我的Agents    │  运行状态/性能监控      │
│  Agent      │  ├─ 市场发现      │  热门/分类/搜索        │
│  (广场)      │  ├─ 任务管理      │  排队中/运行中/历史     │
│             │  └─ 创作Agent     │  可视化配置/代码配置    │
├─────────────────────────────────────────────────────────┤
│             │  ├─ 房间大厅      │  推荐/分类/搜索        │
│  语音        │  ├─ 我的房间      │  创建/管理/统计        │
│  (房间)      │  ├─ 正在通话      │  多人语音/屏幕共享      │
│             │  └─ 通话记录      │  回放/转文字/摘要      │
├─────────────────────────────────────────────────────────┤
│             │  ├─ 联系人        │  好友/群组/组织        │
│  聊天        │  ├─ 文件传输      │  发送/接收/历史        │
│  (聊天)      │  └─ 收藏夹        │  消息/文件/链接        │
├─────────────────────────────────────────────────────────┤
│             │  ├─ 个人资料      │  编辑/隐私/二维码      │
│  我的        │  ├─ 设置          │  主题/通知/安全        │
│  (我的)      │  ├─ 开发者        │  IDE/调试/API          │
│             │  └─ 关于          │  版本/反馈/帮助        │
└─────────────────────────────────────────────────────────┘
```

## 二、布局网格系统

### 2.1 基础网格
```dart
// 8pt 网格系统
class LayoutGrid {
  static const double unit = 8.0;
  
  // 间距
  static const double xs = 4;    // 4pt
  static const double sm = 8;    // 8pt
  static const double md = 16;   // 16pt
  static const double lg = 24;   // 24pt
  static const double xl = 32;   // 32pt
  static const double xxl = 48;  // 48pt
  
  // 圆角
  static const double radiusSm = 8;
  static const double radiusMd = 12;
  static const double radiusLg = 16;
  static const double radiusXl = 24;
  
  // 安全区域
  static const double safeTop = 44;      // 状态栏
  static const double safeBottom = 34;   // Home Indicator
  static const double safeHorizontal = 20; // 左右边距
}
```

### 2.2 响应式断点
```dart
class Breakpoints {
  static const double mobile = 375;   // iPhone SE
  static const double mobileLg = 414; // iPhone Pro Max
  static const double tablet = 768;   // iPad Mini
  static const double desktop = 1024; // iPad Pro
}
```

### 2.3 布局模板

#### A. 列表页模板（首页/消息/Agent）
```
┌─────────────────────────────────┐
│ 状态栏 (44pt)                    │
├─────────────────────────────────┤
│ 导航栏 (56pt)                    │
│ 标题 + 搜索 + 操作按钮            │
├─────────────────────────────────┤
│ 分类标签 (40pt)                  │
│ 横向滚动 Chip 列表               │
├─────────────────────────────────┤
│                                 │
│ 内容区 (剩余高度)                 │
│ ┌─────────────────────────┐    │
│ │ 卡片/列表项              │    │
│ │ 间距: 12pt              │    │
│ └─────────────────────────┘    │
│                                 │
├─────────────────────────────────┤
│ 底部导航 (83pt)                  │
│ Home/Agent/Voice/Chat/Me       │
└─────────────────────────────────┘
```

#### B. 详情页模板（聊天/任务详情）
```
┌─────────────────────────────────┐
│ 状态栏 (44pt)                    │
├─────────────────────────────────┤
│ 导航栏 (56pt)                    │
│ 返回 + 头像/标题 + 更多操作       │
├─────────────────────────────────┤
│                                 │
│ 内容区                          │
│ 可滚动，默认从顶部开始            │
│                                 │
├─────────────────────────────────┤
│ 底部操作区 (自适应)               │
│ 输入框/操作按钮/工具栏            │
└─────────────────────────────────┘
```

#### C. 仪表盘模板（Agent中心）
```
┌─────────────────────────────────┐
│ 状态栏 (44pt)                    │
├─────────────────────────────────┤
│ 导航栏 (56pt)                    │
├─────────────────────────────────┤
│ 统计卡片区 (120pt)               │
│ 3列网格，间距 12pt               │
├─────────────────────────────────┤
│ 快捷操作 (80pt)                  │
│ 横向滚动，图标+文字               │
├─────────────────────────────────┤
│                                 │
│ 列表/网格内容区                   │
│                                 │
├─────────────────────────────────┤
│ FAB 悬浮按钮                      │
└─────────────────────────────────┘
```

#### D. IDE布局模板（开发者模式）
```
┌─────────────────────────────────────────────┐
│ 顶部工具栏 (48pt)                            │
├──────────┬──────────────────┬───────────────┤
│          │                  │               │
│ 文件树    │    代码编辑区     │   预览/Agent  │
│ (200pt)   │   (flex: 1)      │   (280pt)     │
│          │                  │               │
│          │                  │               │
│          │                  │               │
├──────────┴──────────────────┴───────────────┤
│ 底部面板 (可收起，120pt)                      │
│ 终端/日志/调试信息                            │
└─────────────────────────────────────────────┘
```

## 三、功能搭配组合

### 3.1 核心场景组合

#### 场景A：日常聊天
**必备功能：**
- 消息列表（最近会话）
- 消息搜索
- 快捷回复
- 未读消息提醒

**增强功能：**
- 消息置顶
- 免打扰设置
- 草稿保存
- 消息引用回复

**布局要点：**
- 消息气泡左对齐/右对齐
- 时间戳分组（今天/昨天/更早）
- 头像+昵称+内容垂直排列
- 长按菜单（复制/转发/删除）

#### 场景B：AI编程助手
**必备功能：**
- 代码编辑器
- 预览窗口
- AI对话面板
- 文件浏览器

**增强功能：**
- 代码高亮/补全
- 错误提示
- 版本对比
- 一键运行

**布局要点：**
- 三栏布局（文件/代码/预览）
- 可拖拽调整面板宽度
- 标签页管理多个文件
- 底部终端/日志区域

#### 场景C：语音社交
**必备功能：**
- 房间列表
- 快速加入
- 语音控制（ mute/unmute）
- 成员列表

**增强功能：**
- 语音转文字
- 屏幕共享
- 虚拟背景
- 房间录制

**布局要点：**
- 房间卡片突出在线人数
- 语音波形可视化
- 成员头像网格布局
- 悬浮操作按钮

#### 场景D：Agent管理
**必备功能：**
- Agent列表（运行状态）
- 性能监控
- 任务队列
- 快速创建

**增强功能：**
- 实时日志
- 资源使用图表
- 自动扩缩容
- 告警通知

**布局要点：**
- 状态指示器（运行/停止/错误）
- 卡片式布局展示关键指标
- 操作按钮常驻
- 详情抽屉/侧滑

### 3.2 导航结构优化

```
当前: 首页/广场/房间/聊天/我的
优化: 消息/Agent/发现/我的

理由:
1. "消息" 包含单聊+群聊+AI对话，入口更统一
2. "Agent" 作为核心功能独立保留
3. "发现" 整合语音房间+市场+推荐内容
4. "我的" 包含个人+设置+开发者工具
```

### 3.3 快捷入口设计

**全局快捷操作：**
```dart
// 悬浮按钮配置
class QuickActions {
  // 首页: 新建聊天
  static const homeFab = FabConfig(
    icon: Icons.chat_bubble_outline,
    label: '新聊天',
    action: ActionType.newChat,
  );
  
  // Agent: 创建Agent
  static const agentFab = FabConfig(
    icon: Icons.add,
    label: '创建Agent',
    action: ActionType.createAgent,
  );
  
  // 发现: 创建房间
  static const discoverFab = FabConfig(
    icon: Icons.mic,
    label: '开房间',
    action: ActionType.createRoom,
  );
  
  // 展开后更多选项
  static const expandedActions = [
    FabOption(icon: Icons.camera, label: '拍照'),
    FabOption(icon: Icons.image, label: '相册'),
    FabOption(icon: Icons.file_present, label: '文件'),
  ];
}
```

## 四、组件规范

### 4.1 卡片组件
```dart
class AppCard extends StatelessWidget {
  final Widget child;
  final CardType type;
  final VoidCallback? onTap;
  
  // 类型枚举
  enum CardType {
    default_,    // 标准卡片
    elevated,    // 带阴影
    outlined,    // 带边框
    filled,      // 填充背景
    gradient,    // 渐变背景
  }
}
```

### 4.2 列表项组件
```dart
class ListItem extends StatelessWidget {
  final Widget? leading;      // 左侧图标/头像
  final String title;         // 主标题
  final String? subtitle;     // 副标题
  final Widget? trailing;     // 右侧操作
  final ListTileType type;
  
  enum ListTileType {
    singleLine,      // 单行
    twoLine,         // 双行
    threeLine,       // 三行
    withAvatar,      // 带头像
    withIcon,        // 带图标
  }
}
```

### 4.3 空状态组件
```dart
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final String? actionLabel;
  final VoidCallback? onAction;
}
```

## 五、动效规范

### 5.1 页面转场
```dart
class PageTransitions {
  // 标准转场
  static const standard = Duration(milliseconds: 300);
  
  // 快速反馈
  static const quick = Duration(milliseconds: 150);
  
  // 强调动画
  static const emphasized = Duration(milliseconds: 400);
  
  // 缓动曲线
  static const easeInOut = Curves.easeInOut;
  static const easeOut = Curves.easeOut;
  static const spring = Curves.elasticOut;
}
```

### 5.2 微交互
```dart
class MicroInteractions {
  // 按钮按下
  static const buttonPress = Duration(milliseconds: 100);
  
  // 列表项滑动
  static const listSwipe = Duration(milliseconds: 200);
  
  // 卡片展开
  static const cardExpand = Duration(milliseconds: 250);
  
  // Toast提示
  static const toast = Duration(milliseconds: 2000);
}
```

## 六、响应式适配

### 6.1 手机端（< 600pt）
- 单列布局
- 底部导航
- 全屏页面

### 6.2 平板端（600-900pt）
- 双列布局（侧边栏+内容）
- 侧边导航
- 浮层对话框

### 6.3 桌面端（> 900pt）
- 三列布局
- 窗口化管理
- 拖拽调整大小

## 七、无障碍设计

### 7.1 触摸目标
- 最小点击区域：44×44pt
- 按钮间距：≥ 8pt

### 7.2 颜色对比度
- 文字与背景对比度 ≥ 4.5:1
- 大文字对比度 ≥ 3:1

### 7.3 屏幕阅读器
- 所有图片添加描述
- 表单元素添加标签
- 动态内容通知变化
