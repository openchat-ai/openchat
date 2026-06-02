# spec: TaskDetailScreen

> 任务详情页：展示任务基本信息、状态、结果与操作按钮（全部从 SDUI 读取）

## 数据流

```
initState → 注入 SduiPageState mixin
build → sduiLayout['title'|'statusItems'|'infoItems'|'resultItems'|'actions']
  → TaskHeader（标题+图标+描述）
  → StatusSection（statusItems → StatusItem 列表）
  → InfoSection（infoItems → InfoRow 列表）
  → ResultSection（resultItems → ResultStatRow 列表）
  → Actions（actions 列表 → 按钮行）
```

## 接口签名

```dart
class TaskDetailScreen extends ConsumerStatefulWidget {
  final String agentId;
  const TaskDetailScreen({required this.agentId});
}

class _TaskDetailScreenState extends ConsumerState<TaskDetailScreen> with SduiPageState {
  String get sduiPage => 'task_detail';
  Widget build(BuildContext context);  // 组合所有 section
}

Color _hexOr(String? hex, Color fallback);
String _statusColor(String status);
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| sduiLayout 缺字段 | 走硬编码默认值（label=中文，items=4 行默认） |
| 颜色 hex 解析失败 | 走 fallback 颜色（_hexOr 静默） |
| status 非 Completed/In Progress/Pending | 灰色 + 圆形描边 |
| actions 为空 | 渲染空行（不会崩溃） |

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `task_detail_screen.dart` | 主屏、组合 sections | 200 |
| `task_detail_header.dart` | 头部卡片（标题+图标+描述） | 100 |
| `task_detail_status.dart` | 状态 section（list+item） | 90 |
| `task_detail_info.dart` | 信息 section（list+row） | 80 |
| `task_detail_results.dart` | 结果 section（list+row） | 80 |
| `task_detail_actions.dart` | 操作按钮行 | 80 |

## 调试检查点

| C | grep 关键词 | 位置 | 预期 |
|---|------------|------|------|
| C-T1 | sdui load page=task_detail | sdui_config.dart | 加载 task_detail 布局 |

## 不变量（invariants）

```
// === invariants ===
// - 每个 section 独立文件，仅依赖 theme，不持有状态
// - sduiLayout 由父 _TaskDetailScreenState 通过 mixin 提供
// - 颜色解析失败必须静默回退
```
